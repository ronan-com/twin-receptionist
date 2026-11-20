#!/usr/bin/env bash
# Creates the AWS pieces for Twin Receptionist, once. Safe to re-run: each step
# skips anything that already exists.
#
#   EC2 t4g.small (Amazon Linux 2023, arm64) running Docker: app + Caddy (https)
#   RDS Postgres 16 db.t4g.micro, private, reachable only from the app server
#   S3 bucket for deploy bundles, SSM Parameter Store for secrets, Elastic IP
#
# No SSH: the server is managed through SSM (aws ssm start-session / send-command).
set -euo pipefail
export AWS_PAGER=""
R=${AWS_REGION:-ap-southeast-2}
P=twinrecep
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="$P-deploy-$ACCOUNT"
VPC=$(aws ec2 describe-vpcs --region $R --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
SUBNETS=$(aws ec2 describe-subnets --region $R --filters Name=vpc-id,Values=$VPC --query 'Subnets[].SubnetId' --output text)
tag() { echo "ResourceType=$1,Tags=[{Key=Name,Value=$2},{Key=Project,Value=twin-receptionist}]"; }
log() { echo "[provision] $*"; }

# --- security groups -------------------------------------------------------
sg_id() { aws ec2 describe-security-groups --region $R --filters Name=group-name,Values=$1 Name=vpc-id,Values=$VPC --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null; }
APP_SG=$(sg_id $P-app)
if [ "$APP_SG" = "None" ] || [ -z "$APP_SG" ]; then
  APP_SG=$(aws ec2 create-security-group --region $R --vpc-id $VPC --group-name $P-app \
    --description "Twin Receptionist app server: web only" --tag-specifications "$(tag security-group $P-app)" --query GroupId --output text)
  for port in 80 443; do
    aws ec2 authorize-security-group-ingress --region $R --group-id $APP_SG \
      --ip-permissions "IpProtocol=tcp,FromPort=$port,ToPort=$port,IpRanges=[{CidrIp=0.0.0.0/0}],Ipv6Ranges=[{CidrIpv6=::/0}]" >/dev/null
  done
  log "app security group $APP_SG"
fi
DB_SG=$(sg_id $P-db)
if [ "$DB_SG" = "None" ] || [ -z "$DB_SG" ]; then
  DB_SG=$(aws ec2 create-security-group --region $R --vpc-id $VPC --group-name $P-db \
    --description "Twin Receptionist Postgres: app server only" --tag-specifications "$(tag security-group $P-db)" --query GroupId --output text)
  aws ec2 authorize-security-group-ingress --region $R --group-id $DB_SG \
    --ip-permissions "IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=$APP_SG}]" >/dev/null
  log "db security group $DB_SG"
fi

# --- secrets -----------------------------------------------------------------
param_exists() { aws ssm get-parameter --region $R --name "$1" >/dev/null 2>&1; }
put_secret() { aws ssm put-parameter --region $R --name "$1" --type SecureString --value "$2" --overwrite >/dev/null; }
if ! param_exists /$P/db-password; then
  put_secret /$P/db-password "$(openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | head -c 40)"
  log "stored database password"
fi
DB_PASS=$(aws ssm get-parameter --region $R --name /$P/db-password --with-decryption --query Parameter.Value --output text)

# --- database ----------------------------------------------------------------
if ! aws rds describe-db-subnet-groups --region $R --db-subnet-group-name $P >/dev/null 2>&1; then
  aws rds create-db-subnet-group --region $R --db-subnet-group-name $P \
    --db-subnet-group-description "Twin Receptionist" --subnet-ids $SUBNETS >/dev/null
fi
if ! aws rds describe-db-instances --region $R --db-instance-identifier $P-db >/dev/null 2>&1; then
  aws rds create-db-instance --region $R --db-instance-identifier $P-db \
    --engine postgres --engine-version 16.15 --db-instance-class db.t4g.micro \
    --allocated-storage 20 --storage-type gp3 --storage-encrypted \
    --master-username twin --master-user-password "$DB_PASS" --db-name twin \
    --vpc-security-group-ids $DB_SG --db-subnet-group-name $P --no-publicly-accessible \
    --backup-retention-period 7 --deletion-protection --copy-tags-to-snapshot \
    --tags Key=Project,Value=twin-receptionist >/dev/null
  log "database creating (takes ~5-10 min)"
fi

# --- deploy bucket -----------------------------------------------------------
if ! aws s3api head-bucket --bucket $BUCKET 2>/dev/null; then
  aws s3api create-bucket --region $R --bucket $BUCKET --create-bucket-configuration LocationConstraint=$R >/dev/null
  aws s3api put-public-access-block --bucket $BUCKET --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-lifecycle-configuration --bucket $BUCKET --lifecycle-configuration \
    '{"Rules":[{"ID":"old-bundles","Status":"Enabled","Filter":{"Prefix":"bundles/"},"Expiration":{"Days":30}}]}'
  log "bucket $BUCKET"
fi

# --- server role -------------------------------------------------------------
if ! aws iam get-role --role-name $P-app >/dev/null 2>&1; then
  aws iam create-role --role-name $P-app --assume-role-policy-document \
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name $P-app --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
  aws iam put-role-policy --role-name $P-app --policy-name deploy-read --policy-document "{
    \"Version\":\"2012-10-17\",\"Statement\":[
      {\"Effect\":\"Allow\",\"Action\":[\"s3:GetObject\"],\"Resource\":\"arn:aws:s3:::$BUCKET/*\"},
      {\"Effect\":\"Allow\",\"Action\":[\"s3:PutObject\"],\"Resource\":\"arn:aws:s3:::$BUCKET/backups/*\"},
      {\"Effect\":\"Allow\",\"Action\":[\"ssm:GetParameter\",\"ssm:GetParametersByPath\"],\"Resource\":\"arn:aws:ssm:$R:$ACCOUNT:parameter/$P/*\"},
      {\"Effect\":\"Allow\",\"Action\":[\"ses:SendRawEmail\",\"ses:SendEmail\"],\"Resource\":\"*\"}]}"
  aws iam create-instance-profile --instance-profile-name $P-app >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name $P-app --role-name $P-app
  log "server role; waiting for it to propagate"
  sleep 15
fi

# --- server ------------------------------------------------------------------
INSTANCE=$(aws ec2 describe-instances --region $R --filters Name=tag:Name,Values=$P-app Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)
if [ "$INSTANCE" = "None" ]; then
  AMI=$(aws ssm get-parameter --region $R --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --query Parameter.Value --output text)
  INSTANCE=$(aws ec2 run-instances --region $R --image-id $AMI --instance-type t4g.small \
    --iam-instance-profile Name=$P-app --security-group-ids $APP_SG \
    --metadata-options HttpTokens=required,HttpEndpoint=enabled \
    --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=30,VolumeType=gp3,Encrypted=true}' \
    --user-data file://"$(dirname "$0")/user-data.sh" \
    --tag-specifications "$(tag instance $P-app)" "$(tag volume $P-app)" \
    --query 'Instances[0].InstanceId' --output text)
  log "server $INSTANCE launching"
  aws ec2 wait instance-running --region $R --instance-ids $INSTANCE
fi

IP=$(aws ec2 describe-addresses --region $R --filters Name=tag:Name,Values=$P-app --query 'Addresses[0].PublicIp' --output text)
if [ "$IP" = "None" ]; then
  ALLOC=$(aws ec2 allocate-address --region $R --domain vpc --tag-specifications "$(tag elastic-ip $P-app)" --query AllocationId --output text)
  aws ec2 associate-address --region $R --instance-id $INSTANCE --allocation-id $ALLOC >/dev/null
  IP=$(aws ec2 describe-addresses --region $R --allocation-ids $ALLOC --query 'Addresses[0].PublicIp' --output text)
fi

aws rds wait db-instance-available --region $R --db-instance-identifier $P-db
DB_HOST=$(aws rds describe-db-instances --region $R --db-instance-identifier $P-db --query 'DBInstances[0].Endpoint.Address' --output text)
aws ssm put-parameter --region $R --name /$P/db-host --type String --value "$DB_HOST" --overwrite >/dev/null

log "done: server $INSTANCE at $IP, database $P-db, bucket $BUCKET"
