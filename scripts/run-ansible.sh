#!/bin/bash
# Runs the Ansible playbook from the CI server. Terraform's first-boot script starts this
# automatically. Run it again by hand any time (it is safe to repeat):
#
#   /opt/platform/scripts/run-ansible.sh
set -euo pipefail

cd "$(dirname "$0")/../ansible"

K8S_IP="$(awk '/ansible_host=/{sub(".*ansible_host=",""); print $1}' inventory/hosts.ini)"
echo "Waiting for SSH on the Kubernetes node ($K8S_IP)..."
for _ in $(seq 1 60); do
  if ssh -i ~/.ssh/platform-key.pem -o StrictHostKeyChecking=no -o ConnectTimeout=5 "ubuntu@$K8S_IP" true 2>/dev/null; then
    echo "SSH is up."
    break
  fi
  sleep 10
done

ansible-playbook site.yml
echo "Ansible finished. Open Jenkins and run the pipeline."
