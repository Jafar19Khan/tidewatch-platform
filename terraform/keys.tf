# One SSH key for the whole lab. Terraform creates it, registers it with AWS, and saves the
# private half next to these files as platform-key.pem. The CI server also receives a copy so
# Ansible can reach the Kubernetes node.
#
# The private key is stored in Terraform state, so keep the state file private
# (it is git-ignored). In production you would use SSM Session Manager or a secrets manager instead.

resource "tls_private_key" "platform" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "aws_key_pair" "platform" {
  key_name   = "${var.project_name}-key"
  public_key = tls_private_key.platform.public_key_openssh
}

resource "local_sensitive_file" "platform_key" {
  content         = tls_private_key.platform.private_key_pem
  filename        = "${path.module}/platform-key.pem"
  file_permission = "0600"
}

# Generated here so no password is ever written in the repository.
resource "random_password" "grafana" {
  length  = 20
  special = false
}
