# Accelerating LLM Inference on ECS: Leveraging SOCI with AWS Fargate for Lightning-Fast Container Startup
Full AWS-CDK code for Automated SOCI implementation with AWS Fargate and CloudWatch Dashboard showing comparison with non-SOCI.

For more details on how to deploy the infrastructure and the solution details, please refer to the Blog Post:
* [Accelerating LLM Inference on ECS: Leveraging SOCI with AWS Fargate for Lightning-Fast Container Startup)](https://vivek-aws.medium.com/deepseek-r1-inference-on-aws-lambda-using-function-url-no-api-gateway-needed-4d4e4d183164).

## Useful commands

The `cdk.json` file tells the CDK Toolkit how to execute your app.

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
