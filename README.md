# Accelerating LLM Inference on ECS: Leveraging SOCI with AWS Fargate for Lightning-Fast Container Startup
Full AWS-CDK code for Automated SOCI implementation with AWS Fargate and CloudWatch Dashboard showing comparison with non-SOCI.

For more details on how to deploy the infrastructure and the solution details, please refer to the Blog Post:
* [Accelerating LLM Inference on ECS: Leveraging SOCI with AWS Fargate for Lightning-Fast Container Startup)](https://vivek-aws.medium.com/accelerating-llm-inference-on-ecs-leveraging-soci-with-aws-fargate-for-lightning-fast-container-6fb6b7df5b93).

## Useful commands

The `cdk.json` file tells the CDK Toolkit how to execute your app.

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
