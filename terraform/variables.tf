variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "ap-south-1"
}

variable "project_name" {
  description = "Prefix used for resource names and tags."
  type        = string
  default     = "tidewatch"
}

variable "my_ip_cidr" {
  description = "Your public IP in CIDR form, for example 203.0.113.25/32. Only this address can reach SSH, Jenkins, Grafana and Prometheus."
  type        = string

  validation {
    condition     = can(cidrnetmask(var.my_ip_cidr))
    error_message = "my_ip_cidr must be a valid CIDR block such as 203.0.113.25/32."
  }
}

variable "allow_http_cidr" {
  description = "Who may open the website on port 80. Leave empty to allow only my_ip_cidr (recommended: the site has a load generator). Use 0.0.0.0/0 to show it to everyone."
  type        = string
  default     = ""
}

variable "repo_url" {
  description = "HTTPS URL of your PUBLIC GitHub repository for this project. The CI server clones it on first boot to run Ansible."
  type        = string

  validation {
    condition     = startswith(var.repo_url, "https://")
    error_message = "repo_url must start with https://, for example https://github.com/your-name/tidewatch-platform.git"
  }
}

variable "repo_branch" {
  description = "Branch of the repository to clone."
  type        = string
  default     = "main"
}

variable "ci_instance_type" {
  description = "Instance type for the Jenkins and Ansible server (2 GB of RAM or more)."
  type        = string
  default     = "t3.small"
}

variable "k8s_instance_type" {
  description = "Instance type for the Kubernetes node (4 GB of RAM or more is recommended)."
  type        = string
  default     = "c7i-flex.large"
}

variable "ci_volume_gb" {
  description = "Root disk size for the CI server. Jenkins goes offline when free space is low, so keep this at 20 or more."
  type        = number
  default     = 20
}

variable "k8s_volume_gb" {
  description = "Root disk size for the Kubernetes node."
  type        = number
  default     = 20
}
