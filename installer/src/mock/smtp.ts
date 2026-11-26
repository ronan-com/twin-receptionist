// Test mode only: a minimal SMTP server that accepts user "test" / password
// "test-pass" and records messages, so the email check can be tested offline.
import { createServer } from "node:net";

export const mockMail: { from: string; to: string[]; data: string }[] = [];

export function startMockSmtp(port = 4402) {
  createServer((sock) => {
    let authed = false;
    let inData = false;
    let cur = { from: "", to: [] as string[], data: "" };
    let buf = "";
    let authStep = "";
    const say = (s: string) => sock.write(s + "\r\n");
    say("220 mock.smtp ready");
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            mockMail.push(cur);
            cur = { from: "", to: [], data: "" };
            say("250 queued");
          } else cur.data += line + "\n";
          continue;
        }
        if (authStep === "user") {
          authStep = Buffer.from(line, "base64").toString() === "test" ? "pass" : "bad";
          say("334 UGFzc3dvcmQ6");
          continue;
        }
        if (authStep === "pass" || authStep === "bad") {
          const ok = authStep === "pass" && Buffer.from(line, "base64").toString() === "test-pass";
          authStep = "";
          authed = ok;
          say(ok ? "235 ok" : "535 5.7.8 Authentication credentials invalid");
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith("EHLO")) sock.write("250-mock.smtp\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n");
        else if (cmd.startsWith("HELO")) say("250 mock.smtp");
        else if (cmd.startsWith("AUTH PLAIN")) {
          const parts = Buffer.from(line.split(" ")[2] || "", "base64").toString().split("\0");
          authed = parts[1] === "test" && parts[2] === "test-pass";
          say(authed ? "235 ok" : "535 5.7.8 Authentication credentials invalid");
        } else if (cmd.startsWith("AUTH LOGIN")) {
          authStep = "user";
          say("334 VXNlcm5hbWU6");
        } else if (cmd.startsWith("MAIL FROM")) {
          if (!authed) say("530 auth required");
          else (cur.from = line.slice(10)), say("250 ok");
        } else if (cmd.startsWith("RCPT TO")) cur.to.push(line.slice(8)), say("250 ok");
        else if (cmd === "DATA") (inData = true), say("354 go");
        else if (cmd === "RSET" || cmd === "NOOP") say("250 ok");
        else if (cmd === "QUIT") say("221 bye"), sock.end();
        else say("502 not implemented");
      }
    });
    sock.on("error", () => {});
  }).listen(port, "127.0.0.1");
  console.log(`[mock-smtp] fake email server on smtp://test:test-pass@127.0.0.1:${port}`);
}
