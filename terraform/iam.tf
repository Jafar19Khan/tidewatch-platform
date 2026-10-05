# Both servers use IAM roles, so there are no AWS access keys to store or leak.

data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

# ---------- CI server: push images to ECR ----------

resource "aws_iam_role" "ci" {
  name               = "${var.project_name}-ci-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
}

data "aws_iam_policy_document" "ci" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPushToProjectRepository"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:DescribeImages",
    ]
    resources = [aws_ecr_repository.app.arn]
  }
}

resource "aws_iam_role_policy" "ci" {
  name   = "${var.project_name}-ci-policy"
  role   = aws_iam_role.ci.id
  policy = data.aws_iam_policy_document.ci.json
}

# Lets you open a shell from the AWS console if SSH is not working.
resource "aws_iam_role_policy_attachment" "ci_ssm" {
  role       = aws_iam_role.ci.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ci" {
  name = "${var.project_name}-ci-profile"
  role = aws_iam_role.ci.name
}

# ---------- Kubernetes node ----------
# Images are pulled with a short-lived registry secret that Jenkins refreshes on every deploy,
# so this role needs no ECR permissions.

resource "aws_iam_role" "k8s" {
  name               = "${var.project_name}-k8s-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
}

resource "aws_iam_role_policy_attachment" "k8s_ssm" {
  role       = aws_iam_role.k8s.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "k8s" {
  name = "${var.project_name}-k8s-profile"
  role = aws_iam_role.k8s.name
}
