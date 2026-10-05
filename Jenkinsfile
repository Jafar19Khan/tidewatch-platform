// CI/CD pipeline: test, build, scan, push to ECR, deploy to Kubernetes (k3s) with a rolling update.
//
// Terraform and Ansible already prepared the Jenkins server:
//   - Node.js, Docker, the AWS CLI and kubectl are installed
//   - an IAM role lets it push to ECR (no access keys)
//   - /var/lib/jenkins/.kube/config gives kubectl access to the cluster
//   - /var/lib/jenkins/cicd.env holds AWS_REGION, ECR_REPO_URL and K8S_PRIVATE_IP

pipeline {
    agent any

    triggers {
        // Check GitHub for new commits about every 2 minutes
        pollSCM('H/2 * * * *')
    }

    options {
        timestamps()
        timeout(time: 30, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '10'))
        disableConcurrentBuilds()
    }

    environment {
        KUBECONFIG = '/var/lib/jenkins/.kube/config'
    }

    stages {
        stage('Checkout') {
            steps {
                script {
                    def scmVars = checkout scm
                    env.GIT_SHORT = scmVars.GIT_COMMIT.substring(0, 7)
                    env.GIT_BRANCH_NAME = scmVars.GIT_BRANCH ?: ''
                }
            }
        }

        stage('Prepare') {
            steps {
                script {
                    env.AWS_REGION = sh(script: '. /var/lib/jenkins/cicd.env && echo $AWS_REGION', returnStdout: true).trim()
                    env.AWS_DEFAULT_REGION = env.AWS_REGION
                    env.ECR_REPO_URL = sh(script: '. /var/lib/jenkins/cicd.env && echo $ECR_REPO_URL', returnStdout: true).trim()
                    env.K8S_PRIVATE_IP = sh(script: '. /var/lib/jenkins/cicd.env && echo $K8S_PRIVATE_IP', returnStdout: true).trim()
                    env.IMAGE_URI = "${env.ECR_REPO_URL}:${env.BUILD_NUMBER}"
                }
                sh '''
                    node --version && npm --version && docker --version && aws --version
                    kubectl version --client
                    kubectl get nodes || { echo "Cannot reach the cluster. Is Ansible finished? See /var/log/ansible-bootstrap.log"; exit 1; }
                '''
            }
        }

        stage('Lint') {
            steps {
                sh 'npm run lint'
            }
        }

        stage('Test') {
            steps {
                sh 'npm run test:ci'
            }
            post {
                always {
                    junit 'test-results.xml'
                }
            }
        }

        stage('Docker Build') {
            steps {
                sh '''
                    docker build \
                      --build-arg BUILD_NUMBER=${BUILD_NUMBER} \
                      --build-arg GIT_COMMIT=${GIT_SHORT} \
                      --build-arg BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
                      -t ${IMAGE_URI} .
                '''
            }
        }

        stage('Security Scan (Trivy)') {
            steps {
                sh '''
                    # Report HIGH and CRITICAL findings (does not fail the build)
                    docker run --rm \
                      -v /var/run/docker.sock:/var/run/docker.sock \
                      -v trivy-cache:/root/.cache \
                      aquasec/trivy:latest image \
                      --severity HIGH,CRITICAL --ignore-unfixed --exit-code 0 ${IMAGE_URI}

                    # Fail the build if a CRITICAL vulnerability with a fix exists
                    docker run --rm \
                      -v /var/run/docker.sock:/var/run/docker.sock \
                      -v trivy-cache:/root/.cache \
                      aquasec/trivy:latest image \
                      --severity CRITICAL --ignore-unfixed --exit-code 1 --quiet ${IMAGE_URI}
                '''
            }
        }

        stage('Push to ECR') {
            when {
                expression { env.GIT_BRANCH_NAME in ['origin/main', 'main'] }
            }
            steps {
                sh '''
                    aws ecr get-login-password --region ${AWS_REGION} \
                      | docker login --username AWS --password-stdin ${ECR_REPO_URL%%/*}
                    docker push ${IMAGE_URI}
                '''
            }
        }

        stage('Deploy to Kubernetes') {
            when {
                expression { env.GIT_BRANCH_NAME in ['origin/main', 'main'] }
            }
            steps {
                sh '''
                    set -e
                    kubectl apply -f k8s/app/namespace.yaml

                    # ECR passwords expire after 12 hours, so refresh the pull secret on every deploy
                    kubectl -n tidewatch create secret docker-registry ecr-pull \
                      --docker-server=${ECR_REPO_URL%%/*} \
                      --docker-username=AWS \
                      --docker-password="$(aws ecr get-login-password --region ${AWS_REGION})" \
                      --dry-run=client -o yaml | kubectl apply -f -

                    # Put this build's image into the Deployment and apply everything
                    sed "s|__IMAGE__|${IMAGE_URI}|g" k8s/app/deployment.yaml | kubectl apply -f -
                    kubectl apply -f k8s/app/service.yaml -f k8s/app/ingress.yaml -f k8s/app/hpa.yaml -f k8s/app/pdb.yaml
                    kubectl -n tidewatch annotate deployment/tidewatch \
                      kubernetes.io/change-cause="build ${BUILD_NUMBER} (${GIT_SHORT})" --overwrite

                    # Wait for the rolling update. If it fails, go back to the previous version.
                    if ! kubectl -n tidewatch rollout status deployment/tidewatch --timeout=180s; then
                      echo "Rollout failed. Rolling back to the previous version."
                      kubectl -n tidewatch rollout undo deployment/tidewatch
                      kubectl -n tidewatch rollout status deployment/tidewatch --timeout=120s || true
                      exit 1
                    fi

                    kubectl -n tidewatch get pods -o wide
                '''
            }
        }

        stage('Verify Live Site') {
            when {
                expression { env.GIT_BRANCH_NAME in ['origin/main', 'main'] }
            }
            steps {
                sh '''
                    curl -fsS http://${K8S_PRIVATE_IP}/api/version | tee version.json
                    grep -q "\\"build\\":\\"${BUILD_NUMBER}\\"" version.json
                    echo
                    echo "Build ${BUILD_NUMBER} is live."
                '''
            }
        }
    }

    post {
        success {
            echo 'CI/CD pipeline PASSED'
        }
        failure {
            echo 'CI/CD pipeline FAILED. Check the stage logs above.'
        }
        cleanup {
            sh 'docker image prune -f --filter "until=48h" || true'
            cleanWs()
        }
    }
}
