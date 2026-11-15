"""Upload and verify one static page using the organizer's scoped OVH SFTP account."""

import hashlib
import os
from pathlib import Path
import secrets
import stat
import sys

import paramiko


HOST = "ftp.cluster102.hosting.ovh.net"
USERNAME = "juliendo-menuorg"
SFTP_HOME = f"/home/{USERNAME}"
KNOWN_HOSTS = Path(__file__).with_name("ovh_known_hosts")


def publish(page):
    if os.environ.get("FTP_SERVER") != HOST or os.environ.get("FTP_USERNAME") != USERNAME:
        raise SystemExit("Expected the organizer's dedicated OVH SFTP host and account")
    if not os.environ.get("FTP_PASSWORD"):
        raise SystemExit("The SFTP password is missing")
    contents = page.read_bytes()
    expected = hashlib.sha256(contents).digest()
    temporary = f".organizer-{secrets.token_hex(12)}.upload"
    with paramiko.SSHClient() as client:
        client.load_host_keys(str(KNOWN_HOSTS))
        client.connect(HOST, port=22, username=USERNAME, password=os.environ["FTP_PASSWORD"],
                       allow_agent=False, look_for_keys=False, timeout=15, auth_timeout=15)
        with client.open_sftp() as sftp:
            sftp.get_channel().settimeout(30)
            if sftp.normalize(".") != SFTP_HOME or not stat.S_ISDIR(sftp.lstat(SFTP_HOME).st_mode):
                raise SystemExit("OVH returned an unexpected SFTP home")
            sftp.chdir(SFTP_HOME)
            try:
                with sftp.file(temporary, "xw") as uploaded:
                    uploaded.write(contents)
                with sftp.file(temporary, "rb") as uploaded:
                    if hashlib.sha256(uploaded.read()).digest() != expected:
                        raise SystemExit("Uploaded file differs from the built page")
                sftp.posix_rename(temporary, "index.html")
            finally:
                try:
                    sftp.remove(temporary)
                except FileNotFoundError:
                    pass


if __name__ == "__main__":
    publish(Path(sys.argv[1]))
