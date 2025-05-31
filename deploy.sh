#!/usr/bin/env bash

cfn-lint -t infrastructure/template.yaml
sam validate -t infrastructure/template.yaml --region eu-west-2
sam validate -t infrastructure/template.yaml --lint
sam build -t infrastructure/template.yaml --parallel --cached

sam deploy --stack-name "pokerpoint-backend" \
  --no-fail-on-empty-changeset \
  --no-confirm-changeset \
  --resolve-s3 \
  --s3-prefix "pokerpoint" \
  --region "${AWS_REGION:-eu-west-2}" \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --profile pokerpoint
