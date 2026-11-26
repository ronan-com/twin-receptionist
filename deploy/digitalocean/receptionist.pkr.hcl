# DigitalOcean Marketplace 1-Click image: Ubuntu 24.04 + Docker + the self-host stack with every
# image already built and pulled. No settings, secrets or database volumes are baked in; the
# buyer's first boot asks for them (files/oneclick.py) or reads them from user data.
#   bash deploy/selfhost/make-bundle.sh
#   packer init deploy/digitalocean && DIGITALOCEAN_TOKEN=... packer build deploy/digitalocean
packer {
  required_plugins {
    digitalocean = {
      version = ">= 1.4.0"
      source  = "github.com/digitalocean/digitalocean"
    }
  }
}

variable "do_token" {
  type      = string
  default   = env("DIGITALOCEAN_TOKEN")
  sensitive = true
}

variable "region" {
  type    = string
  default = "syd1"
}

# DigitalOcean asks for the smallest build Droplet: the image's disk size becomes the minimum
# for every buyer. The app build gets a temporary swap file instead of a bigger Droplet.
variable "size" {
  type    = string
  default = "s-1vcpu-1gb"
}

# Empty means ../selfhost/out/selfhost-bundle.tgz (made by deploy/selfhost/make-bundle.sh).
variable "bundle" {
  type    = string
  default = ""
}

variable "snapshot_regions" {
  type    = list(string)
  default = []
}

locals {
  stamp  = formatdate("YYYYMMDD-hhmm", timestamp())
  bundle = var.bundle != "" ? var.bundle : "${path.root}/../selfhost/out/selfhost-bundle.tgz"
}

source "digitalocean" "receptionist" {
  api_token        = var.do_token
  image            = "ubuntu-24-04-x64"
  region           = var.region
  size             = var.size
  ssh_username     = "root"
  snapshot_name    = "receptionist-1click-${local.stamp}"
  snapshot_regions = var.snapshot_regions
  droplet_agent    = false
  monitoring       = false
  ipv6             = false
  tags             = ["receptionist-image-build"]
}

build {
  sources = ["source.digitalocean.receptionist"]

  # Let the base image's own first boot finish (exit 2 = finished with warnings).
  provisioner "shell" {
    inline = ["cloud-init status --wait || [ $? -eq 2 ]", "mkdir -p /tmp/oneclick"]
  }

  provisioner "file" {
    source      = local.bundle
    destination = "/tmp/selfhost-bundle.tgz"
  }

  provisioner "file" {
    source      = "${path.root}/files/"
    destination = "/tmp/oneclick"
  }

  provisioner "shell" {
    environment_vars = ["DEBIAN_FRONTEND=noninteractive", "LC_ALL=C"]
    scripts = [
      "${path.root}/scripts/10-system.sh",
      "${path.root}/scripts/20-app.sh",
      "${path.root}/scripts/30-oneclick.sh",
      "${path.root}/scripts/90-cleanup.sh",   # DigitalOcean's, unchanged
      "${path.root}/scripts/99-img-check.sh", # DigitalOcean's, unchanged; fails the build on any FAIL
    ]
  }
}
