# The default VPC keeps the setup small.

data "aws_vpc" "default" {
  default = true
}

locals {
  http_cidr = var.allow_http_cidr != "" ? var.allow_http_cidr : var.my_ip_cidr
}

resource "aws_security_group" "ci" {
  name        = "${var.project_name}-ci"
  description = "CI server: Jenkins and SSH from my IP"
  vpc_id      = data.aws_vpc.default.id
}

resource "aws_security_group" "k8s" {
  name        = "${var.project_name}-k8s"
  description = "Kubernetes node: website, Grafana, Prometheus and SSH"
  vpc_id      = data.aws_vpc.default.id
}

# ---------- CI server ----------

resource "aws_vpc_security_group_ingress_rule" "ci_ssh" {
  security_group_id = aws_security_group.ci.id
  description       = "SSH from my IP"
  from_port         = 22
  to_port           = 22
  ip_protocol       = "tcp"
  cidr_ipv4         = var.my_ip_cidr
}

resource "aws_vpc_security_group_ingress_rule" "ci_jenkins" {
  security_group_id = aws_security_group.ci.id
  description       = "Jenkins UI from my IP"
  from_port         = 8080
  to_port           = 8080
  ip_protocol       = "tcp"
  cidr_ipv4         = var.my_ip_cidr
}

resource "aws_vpc_security_group_ingress_rule" "ci_node_exporter" {
  security_group_id            = aws_security_group.ci.id
  description                  = "Prometheus (on the Kubernetes node) scrapes server metrics"
  from_port                    = 9100
  to_port                      = 9100
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.k8s.id
}

resource "aws_vpc_security_group_egress_rule" "ci_all" {
  security_group_id = aws_security_group.ci.id
  description       = "All outbound traffic"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# ---------- Kubernetes node ----------

resource "aws_vpc_security_group_ingress_rule" "k8s_ssh_me" {
  security_group_id = aws_security_group.k8s.id
  description       = "SSH from my IP"
  from_port         = 22
  to_port           = 22
  ip_protocol       = "tcp"
  cidr_ipv4         = var.my_ip_cidr
}

resource "aws_vpc_security_group_ingress_rule" "k8s_ssh_ci" {
  security_group_id            = aws_security_group.k8s.id
  description                  = "SSH from the CI server (Ansible)"
  from_port                    = 22
  to_port                      = 22
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.ci.id
}

resource "aws_vpc_security_group_ingress_rule" "k8s_http" {
  security_group_id = aws_security_group.k8s.id
  description       = "Website"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
  cidr_ipv4         = local.http_cidr
}

resource "aws_vpc_security_group_ingress_rule" "k8s_http_ci" {
  security_group_id            = aws_security_group.k8s.id
  description                  = "Jenkins checks the deployed site"
  from_port                    = 80
  to_port                      = 80
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.ci.id
}

resource "aws_vpc_security_group_ingress_rule" "k8s_api_ci" {
  security_group_id            = aws_security_group.k8s.id
  description                  = "Kubernetes API for Jenkins (kubectl)"
  from_port                    = 6443
  to_port                      = 6443
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.ci.id
}

resource "aws_vpc_security_group_ingress_rule" "k8s_grafana" {
  security_group_id = aws_security_group.k8s.id
  description       = "Grafana from my IP"
  from_port         = 30300
  to_port           = 30300
  ip_protocol       = "tcp"
  cidr_ipv4         = var.my_ip_cidr
}

resource "aws_vpc_security_group_ingress_rule" "k8s_prometheus" {
  security_group_id = aws_security_group.k8s.id
  description       = "Prometheus from my IP"
  from_port         = 30090
  to_port           = 30090
  ip_protocol       = "tcp"
  cidr_ipv4         = var.my_ip_cidr
}

resource "aws_vpc_security_group_egress_rule" "k8s_all" {
  security_group_id = aws_security_group.k8s.id
  description       = "All outbound traffic"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}
