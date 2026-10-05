output "jenkins_url" {
  description = "Jenkins web UI (ready about 5 to 8 minutes after apply)."
  value       = "http://${aws_instance.ci.public_ip}:8080"
}

output "website_url" {
  description = "The Tidewatch website (live after the first successful pipeline run)."
  value       = "http://${aws_instance.k8s.public_ip}"
}

output "grafana_url" {
  description = "Grafana dashboards (ready about 15 minutes after apply)."
  value       = "http://${aws_instance.k8s.public_ip}:30300"
}

output "prometheus_url" {
  description = "Prometheus UI."
  value       = "http://${aws_instance.k8s.public_ip}:30090"
}

output "grafana_admin_password" {
  description = "Grafana admin password (user: admin). Show it with: terraform output -raw grafana_admin_password"
  value       = random_password.grafana.result
  sensitive   = true
}

output "ecr_repository_url" {
  description = "Container registry where Jenkins pushes images."
  value       = aws_ecr_repository.app.repository_url
}

output "ssh_ci_server" {
  description = "Log in to the CI server (the key file is created in the terraform folder)."
  value       = "ssh -i platform-key.pem ubuntu@${aws_instance.ci.public_ip}"
}

output "ssh_k8s_node" {
  description = "Log in to the Kubernetes node."
  value       = "ssh -i platform-key.pem ubuntu@${aws_instance.k8s.public_ip}"
}

output "watch_setup_progress" {
  description = "Run on the CI server to follow the automatic Ansible setup."
  value       = "tail -f /var/log/ansible-bootstrap.log"
}
