# Setup guide

This guide takes you from nothing to a live platform. Time needed: about 1 hour, most of it
waiting while servers install their software.

The commands use Windows PowerShell. On macOS or Linux they work the same, except where noted.

## 0. Before you start

1. **Secure your AWS account.** Turn on MFA for the root user, then create an IAM user for
   the command line instead of using root keys:
   IAM, Users, Create user (name `terraform-admin`), attach `AdministratorAccess`, then
   Security credentials, Create access key, use case **Command Line Interface**.
   Keep the keys private. Never paste them into chats, screenshots or Git.
2. **Create a budget alert.** Billing and Cost Management, Budgets, Create budget, choose a
   monthly cost budget of a few dollars with an email alert.
3. **Install the tools:**
   ```powershell
   winget install Hashicorp.Terraform
   winget install Amazon.AWSCLI
   winget install Git.Git
   ```
   Open a new PowerShell window, then check:
   ```powershell
   terraform -version
   aws --version
   git --version
   ```
4. **Connect the AWS CLI** to your IAM user:
   ```powershell
   aws configure
   aws sts get-caller-identity
   ```
   Use region `ap-south-1` (or another region you prefer) and output format `json`.

## 1. Put the project on GitHub (public)

The CI server clones your repository on first boot, so it must exist on GitHub and be **public**
before you run Terraform. Put your name in `LICENSE`, then:

```powershell
cd tidewatch-platform
git init
git add .
git status
git commit -m "Initial commit: Tidewatch platform"
git branch -M main
git remote add origin https://github.com/<your-username>/tidewatch-platform.git
git push -u origin main
```

Before pushing, check `git status`: no `.pem`, `.tfstate` or `terraform.tfvars` files should be listed.

## 2. Check the instance types are available

The defaults are `t3.small` (CI server) and `c7i-flex.large` (Kubernetes node). Check that both
exist in your region (replace the region if you use another one):

```powershell
aws ec2 describe-instance-type-offerings --region ap-south-1 --filters Name=instance-type,Values=t3.small,c7i-flex.large --query "InstanceTypeOfferings[].InstanceType" --output text
```

Both names should be printed. To see which types your account treats as free-tier eligible:

```powershell
aws ec2 describe-instance-types --region ap-south-1 --filters Name=free-tier-eligible,Values=true --query "InstanceTypes[*].[InstanceType]" --output text
```

If a type is missing or not eligible, set a different one in `terraform.tfvars` (step 3).
The Kubernetes node should have at least 4 GB of RAM. `m7i-flex.large` has more (8 GB).

## 3. Configure Terraform

```powershell
cd terraform
copy terraform.tfvars.example terraform.tfvars
(Invoke-RestMethod https://checkip.amazonaws.com).Trim()
notepad terraform.tfvars
```

Set:

- `my_ip_cidr`: the IP address printed above, followed by `/32`
- `repo_url`: your GitHub repository URL, for example `https://github.com/<your-username>/tidewatch-platform.git`

Optional: `allow_http_cidr = "0.0.0.0/0"` lets anyone open the website.

## 4. Create the platform

```powershell
terraform init
terraform plan
```

The plan should end with `Plan: 29 to add, 0 to change, 0 to destroy.` Then:

```powershell
terraform apply
```

Type `yes`. **Charges start here.** Terraform prints the URLs. It also creates
`platform-key.pem` in the terraform folder, which is your SSH key.

If SSH complains that the key file is too open, fix its permissions:

```powershell
icacls .\platform-key.pem /inheritance:r
icacls .\platform-key.pem /grant:r "$($env:USERNAME):(R)"
```

## 5. Wait for the automatic setup (about 15 minutes)

The CI server installs Jenkins, then runs Ansible, which installs Kubernetes, Prometheus and
Grafana on the other server. Follow along:

```powershell
terraform output ssh_ci_server
```

Run the SSH command it prints, then on the CI server:

```bash
tail -n 3 /var/log/user-data.log           # ends with "First boot finished"
tail -f /var/log/ansible-bootstrap.log     # ends with "Ansible finished"
```

(Press `Ctrl + C` to stop following.) If Ansible fails, fix the cause and run
`/opt/platform/scripts/run-ansible.sh` again. It is safe to repeat.

## 6. Unlock Jenkins

On the CI server:

```bash
sudo cat /var/lib/jenkins/secrets/initialAdminPassword
```

Open `jenkins_url` from the Terraform output, paste the password, choose **Install suggested
plugins**, and create your admin user.

## 7. Create the pipeline job

1. **New Item**, name `tidewatch`, type **Pipeline**
2. **Pipeline** section: Definition **Pipeline script from SCM**, SCM **Git**
3. Repository URL: your GitHub repository URL, Branch Specifier `*/main`, Script Path `Jenkinsfile`
4. **Save**, then **Build Now**

The first build takes longer because Trivy downloads its vulnerability database. When all stages
are green, open `website_url`. Polling is defined in the `Jenkinsfile`, so later pushes start
builds by themselves (within about 2 minutes, after the first build).

## 8. Open Grafana and Prometheus

- Grafana: `grafana_url`, user `admin`, password from `terraform output -raw grafana_admin_password`.
  The dashboard is **Tidewatch overview** in the Tidewatch folder.
- Prometheus: `prometheus_url`. Check **Status, Targets** (everything should be `UP`) and **Alerts**.

## 9. Try the demos

**Ship a change.** Edit the headline in `public/index.html`, commit and push. Within about two
minutes a build starts. Refresh the website to see the change and the new build number.

**Autoscaling.** Click **Start load** on the website (or run
`node scripts/loadtest.js http://<website-ip> 120 16` on your laptop). On the Kubernetes node:

```bash
ssh -i platform-key.pem ubuntu@<k8s-ip>
sudo k3s kubectl -n tidewatch get hpa -w
sudo k3s kubectl -n tidewatch get pods
```

Watch the replicas grow from 2 towards 5 in the terminal, on the website and in Grafana.

**Rollback.** Add `process.exit(1);` as the first line of `src/server.js`, commit and push. The
build passes lint, tests and the scan, but the new pods crash. Jenkins rolls back and the site
stays up. Remove the line and push again.

**Alert.** On the Kubernetes node:

```bash
sudo k3s kubectl -n tidewatch delete hpa tidewatch
sudo k3s kubectl -n tidewatch scale deployment tidewatch --replicas=0
```

After about a minute the `TidewatchDown` alert fires in Prometheus. Run the pipeline again to
restore the app and the autoscaler.

Useful commands:

```bash
sudo k3s kubectl -n tidewatch rollout history deployment/tidewatch
sudo k3s kubectl -n tidewatch logs deployment/tidewatch
sudo k3s kubectl -n monitoring get pods
```

## 10. Take screenshots

Before cleaning up, capture the Jenkins stage view (including a failed build), the website while
pods scale, the Grafana dashboard, and the Prometheus alerts page. Add them to the README.

## 11. Clean up

```powershell
cd terraform
terraform destroy
```

Type `yes`. This deletes both servers, disks, the registry, roles and security groups. Then:

- Check the EC2 and ECR consoles for leftovers
- Look at the Billing page the next day
- Delete `platform-key.pem` if you no longer need it

## Optional: keep Terraform state in S3

See `terraform/backend.tf.example`. First run `terraform apply` inside `terraform/bootstrap` to
create the bucket, then copy the example to `backend.tf` and run `terraform init -migrate-state`.

## Common mistakes

- Forgetting that your IP can change: Jenkins, SSH and Grafana stop responding until you update `my_ip_cidr`.
- Making the GitHub repository private: the CI server cannot clone it.
- Leaving the platform running after the demo: run `terraform destroy`.
- Using `curl` in Windows PowerShell for API tests: use `Invoke-RestMethod` or `curl.exe`.
