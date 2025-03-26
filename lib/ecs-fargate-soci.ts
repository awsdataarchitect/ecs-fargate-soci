import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as ecr_deployment from 'cdk-ecr-deployment';
import { SociIndexBuild } from 'deploy-time-build';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';


export class EcsFargateSociStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a VPC with public subnets only (no NAT gateway)
    const vpc = new ec2.Vpc(this, 'OllamaVpc', {
      maxAzs: 2,
      subnetConfiguration: [
        {
          name: 'public-subnet',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        }
      ],
      natGateways: 0,
    });

    // Create task execution role with required permissions
    const executionRole = new iam.Role(this, 'EcsTaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    executionRole.addToPrincipalPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ssmmessages:CreateDataChannel",
        "ssmmessages:OpenDataChannel",
        "ssmmessages:OpenControlChannel",
        "ssmmessages:CreateControlChannel",
      ],
      resources: ["*"] //adjust as per your need
    }));

    const ollamaRepoSoci = new ecr.Repository(this, 'OllamaEcrRepoSoci', {
      repositoryName: 'ollama-fargate-soci',
      imageScanOnPush: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true
    });

    const ollamaRepoNonSoci = new ecr.Repository(this, 'OllamaEcrRepoNonSoci', {
      repositoryName: 'ollama-fargate-non-soci',
      imageScanOnPush: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true
    });

    // Build the Docker image
    const appImageAsset = new ecr_assets.DockerImageAsset(this, 'OllamaImage', {
      directory: './lib/docker',
      //platform: ecr_assets.Platform.LINUX_ARM64,
      platform: ecr_assets.Platform.LINUX_AMD64,
    });

    const amilazy = new ecr_assets.DockerImageAsset(this, 'amilazyImage', {
      directory: './lib/docker/amilazy',
      //platform: ecr_assets.Platform.LINUX_ARM64,
      platform: ecr_assets.Platform.LINUX_AMD64,
    });

    // Deploy the Docker image to the ECR repository
    const imageDeploymentSoci = new ecr_deployment.ECRDeployment(this, 'DeployDockerImageSoci', {
      src: new ecr_deployment.DockerImageName(appImageAsset.imageUri),
      dest: new ecr_deployment.DockerImageName(`${ollamaRepoSoci.repositoryUri}:` + appImageAsset.imageTag),
    });


    // Deploy the Docker image to the ECR repository
    const imageDeploymentNonSoci = new ecr_deployment.ECRDeployment(this, 'DeployDockerImageNonSoci', {
      src: new ecr_deployment.DockerImageName(appImageAsset.imageUri),
      dest: new ecr_deployment.DockerImageName(`${ollamaRepoNonSoci.repositoryUri}:` + appImageAsset.imageTag),

    });

    // Create SOCI index after the image has been deployed
    const sociIndexBuild = new SociIndexBuild(this, 'Index', {
      repository: ollamaRepoSoci,
      imageTag: appImageAsset.imageTag,
    });

    // // Ensure SOCI index creation happens after image deployment
    sociIndexBuild.node.addDependency(imageDeploymentSoci);

    // Create an ECS cluster
    const cluster = new ecs.Cluster(this, 'OllamaCluster', {
      vpc,
      clusterName: 'soci-fargate-demo'
    });

    cluster.node.addDependency(imageDeploymentSoci)
    cluster.node.addDependency(imageDeploymentNonSoci)

    // Create task role for the container
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Add permissions for CloudWatch Logs and Metrics
    taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        "logs:DescribeLogStreams",
        "logs:DescribeLogGroups",
        'cloudwatch:PutMetricData',
      ],
      resources: ['*'],
    }));

    const amilazyLogGroup = new logs.LogGroup(this, 'soci', {
      logGroupName: '/aws/ecs/amilazy', // You can customize this name
      retention: logs.RetentionDays.ONE_DAY, // Optional: set retention period
    });

    // Create SOCI-enabled and non-SOCI task definitions
    const sociTaskDef = this.createTaskDefinition(amilazyLogGroup, appImageAsset, amilazy, 'SociTaskDef', true, executionRole, taskRole, ollamaRepoSoci);
    const nonSociTaskDef = this.createTaskDefinition(amilazyLogGroup, appImageAsset, amilazy, 'NonSociTaskDef', false, executionRole, taskRole, ollamaRepoNonSoci);

    sociTaskDef.node.addDependency(imageDeploymentSoci);
    nonSociTaskDef.node.addDependency(imageDeploymentNonSoci);
    nonSociTaskDef.node.addDependency(amilazyLogGroup);
    sociTaskDef.node.addDependency(amilazyLogGroup);

    // Create Fargate services for both task definitions
    const sociService = this.createFargateService('SociService', cluster, sociTaskDef);
    const nonSociService = this.createFargateService('NonSociService', cluster, nonSociTaskDef);

    // Create CloudWatch dashboard
    const dashboard = this.createPerformanceDashboard();
    dashboard.node.addDependency(sociTaskDef);
    dashboard.node.addDependency(nonSociTaskDef);
    dashboard.node.addDependency(sociService);
    dashboard.node.addDependency(nonSociService);
    dashboard.node.addDependency(cluster);

  }

  private createTaskDefinition(amilazyLogGroup: logs.LogGroup, asset: ecr_assets.DockerImageAsset, amilazy: ecr_assets.DockerImageAsset, id: string, enableSoci: boolean, executionRole: iam.IRole, taskRole: iam.IRole, repo: ecr.IRepository): ecs.FargateTaskDefinition {
    const taskDef = new ecs.FargateTaskDefinition(this, id, {
      family: 'taskDef' + (enableSoci ? '-soci' : '-non-soci'),
      memoryLimitMiB: 8192,
      cpu: 2048, //1024
      executionRole: executionRole,
      taskRole: taskRole,
      runtimePlatform: {
        // cpuArchitecture: ecs.CpuArchitecture.ARM64,
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
      },

    });


    // Add amilazy sidecar container
    taskDef.addContainer('amilazy', {
      image: ecs.ContainerImage.fromDockerImageAsset(amilazy),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'amilazy' + (enableSoci ? '-soci' : '-non-soci'),
        mode: ecs.AwsLogDriverMode.NON_BLOCKING,
        logGroup: amilazyLogGroup, // Reference the log group here
      }),
      essential: false,
    });

    const container = taskDef.addContainer('OllamaContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repo, asset.imageTag),
      environment: {
        LOG_LEVEL: 'DEBUG',
        MALLOC_ARENA_MAX: '2',
        OLLAMA_MODEL: 'deepseek-r1:1.5b',
        OLLAMA_HOST: '0.0.0.0', 
        HOME: '/tmp',
        OLLAMA_MODELS: '/tmp',
        LD_LIBRARY_PATH: '/var/task/lib',
        SERVICE_NAME: enableSoci ? 'SociService' : 'NonSociService'
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: `ollama-fargate-${enableSoci ? 'soci' : 'non-soci'}`,
        mode: ecs.AwsLogDriverMode.NON_BLOCKING,
      }),

    });

    container.addPortMappings(
      { containerPort: 8080, protocol: ecs.Protocol.TCP},
      { containerPort: 11434, protocol: ecs.Protocol.TCP }
    );

    taskDef.addToTaskRolePolicy(new iam.PolicyStatement({
      actions: [
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage',
        'ecr:BatchCheckLayerAvailability',
        'ecr:GetRepositoryPolicy',
        'ecr:DescribeRepositories',
        'ecr:ListImages',
        'ecr:DescribeImages',
      ],
      resources: [`${repo.repositoryArn}:*`], // Include all image tags
    }));
    taskDef.addToTaskRolePolicy(new iam.PolicyStatement({
      actions: ['ecr:GetAuthorizationToken'],
      resources: ['*'],
    }));

    return taskDef

  }

  private createFargateService(id: string, cluster: ecs.ICluster, taskDefinition: ecs.FargateTaskDefinition): ecs_patterns.ApplicationLoadBalancedFargateService {    
    const service = new ecs_patterns.ApplicationLoadBalancedFargateService(this, id, {
      cluster: cluster,
      serviceName: id,
      taskDefinition: taskDefinition,
      desiredCount: 1,
      publicLoadBalancer: true,
      assignPublicIp: true,
      taskSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      enableExecuteCommand: true,
    });

    service.targetGroup.setAttribute('deregistration_delay.timeout_seconds', '0');

    // Configure target group health check
    service.targetGroup.configureHealthCheck({
      path: '/health', 
      port: '8080',
      healthyHttpCodes: '200',
      timeout: cdk.Duration.seconds(10), //was 5,10
      interval: cdk.Duration.seconds(25),//20 health check fail was 30,25, 
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3
    });

    // speed up deployments, it should be used cautiously
    const cfnService = service.service.node.defaultChild as ecs.CfnService;
    cfnService.deploymentConfiguration = {
      maximumPercent: 200,
      minimumHealthyPercent: 0,
      deploymentCircuitBreaker: {
        enable: true,
        rollback: true,
      },
    };
    const listener11434 = service.loadBalancer.addListener('OllamaListener', {
      port: 11434, // New port for Ollama
      protocol: elb.ApplicationProtocol.HTTP,
      open: false,
    });

    // Attach a new target group to route traffic to Ollama's port
    listener11434.addTargets('OllamaTargetGroup', {
      targets: [service.service],
      port: 11434,
      protocol: elb.ApplicationProtocol.HTTP,
      healthCheck: {
        path: "/", // Adjust if necessary
        interval: cdk.Duration.seconds(25),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2
      }
    });

    // const scalableTarget = service.service.autoScaleTaskCount({
    //   minCapacity: 1,
    //   maxCapacity: 2,
    // });

    // scalableTarget.scaleOnCpuUtilization('CpuScaling', {
    //   targetUtilizationPercent: 70,
    //   scaleInCooldown: cdk.Duration.seconds(60),
    //   scaleOutCooldown: cdk.Duration.seconds(60),
    // });

    return service;
  }


  private createPerformanceDashboard() {
    const dashboard = new cloudwatch.Dashboard(this, 'OllamaPerformanceComparisonDashboard', {
      dashboardName: 'SOCI-Performance-Comparison-Dashboard',
    });

    const namespace = 'SOCI/Performance/v1'
    // Add explanatory text widget at the top
    dashboard.addWidgets(new cloudwatch.TextWidget({
      markdown: `# SOCI vs Non-SOCI Performance Comparison
      
This dashboard compares performance metrics between container deployments with and without SOCI enabled.
* **SOCI Service** (blue): Container using Seekable OCI (SOCI)
* **Non-SOCI Service** (orange): Standard container deployment`,
      width: 24,
      height: 3,
    }));

    // Image Pull Latency Comparison
    const sociImagePullMetric = new cloudwatch.Metric({
      namespace: namespace,
      metricName: 'ImagePullTime',
      dimensionsMap: { ServiceName: 'SociService' },
      statistic: 'Average',
      label: 'SOCI Image Pull Time'
    });

    const nonSociImagePullMetric = new cloudwatch.Metric({
      namespace: namespace,
      metricName: 'ImagePullTime',
      dimensionsMap: { ServiceName: 'NonSociService' },
      statistic: 'Average',
      label: 'Non-SOCI Image Pull Time'
    });

    const imagePullWidget = new cloudwatch.GraphWidget({
      title: 'Image Pull Time Comparison',
      left: [sociImagePullMetric, nonSociImagePullMetric],
      width: 24,
      height: 6,
      legendPosition: cloudwatch.LegendPosition.RIGHT,
      period: cdk.Duration.minutes(5),
      view: cloudwatch.GraphWidgetView.BAR,
      stacked: false,
      leftYAxis: {
        showUnits: true,
        label: 'Seconds'
      }
    });

    // Overall Improvement Percentage
    const improvementMetric = new cloudwatch.MathExpression({
      expression: '100 * (m2 - m1) / m2',
      label: 'Performance Improvement (%)',
      usingMetrics: {
        m1: sociImagePullMetric,
        m2: nonSociImagePullMetric,
      },
      period: cdk.Duration.minutes(5),
    });

    const improvementWidget = new cloudwatch.SingleValueWidget({
      title: 'Overall Performance Improvement with SOCI',
      metrics: [improvementMetric],
      width: 24,
      height: 3,
      sparkline: false,
    });

    // Add all widgets to the dashboard
    dashboard.addWidgets(
      imagePullWidget,
      improvementWidget
    );

    return dashboard;
  }

}
