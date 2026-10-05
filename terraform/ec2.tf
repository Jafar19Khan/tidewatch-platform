data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ---------- Kubernetes node: k3s, the app, Prometheus and Grafana run here ----------
# Ansible installs everything on it, so its first-boot script is tiny.

resource "aws_instance" "k8s" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.k8s_instance_type
  key_name               = aws_key_pair.platform.key_name
  vpc_security_group_ids = [aws_security_group.k8s.id]
  iam_instance_profile   = aws_iam_instance_profile.k8s.name

  user_data                   = file("${path.module}/user_data/k8s.sh.tftpl")
  user_data_replace_on_change = true

  # Require IMDSv2 (blocks a common credential-theft technique)
  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  root_block_device {
    volume_size = var.k8s_volume_gb
    volume_type = "gp3"
    encrypted   = true
  }

  tags = {
    Name = "${var.project_name}-k8s-node"
  }
}

# ---------- CI server: Jenkins, Docker, Ansible ----------

resource "aws_instance" "ci" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.ci_instance_type
  key_name               = aws_key_pair.platform.key_name
  vpc_security_group_ids = [aws_security_group.ci.id]
  iam_instance_profile   = aws_iam_instance_profile.ci.name

  user_data = templatefile("${path.module}/user_data/ci.sh.tftpl", {
    region               = var.aws_region
    ecr_repo_url         = aws_ecr_repository.app.repository_url
    k8s_private_ip       = aws_instance.k8s.private_ip
    grafana_password     = random_password.grafana.result
    platform_private_key = tls_private_key.platform.private_key_pem
    repo_url             = var.repo_url
    repo_branch          = var.repo_branch
  })
  user_data_replace_on_change = true

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  # Burstable (t*) instances: stay in "standard" mode so heavy builds cannot cause surprise charges.
  dynamic "credit_specification" {
    for_each = startswith(var.ci_instance_type, "t") ? [1] : []
    content {
      cpu_credits = "standard"
    }
  }

  root_block_device {
    volume_size = var.ci_volume_gb
    volume_type = "gp3"
    encrypted   = true
  }

  tags = {
    Name = "${var.project_name}-ci-server"
  }
}
