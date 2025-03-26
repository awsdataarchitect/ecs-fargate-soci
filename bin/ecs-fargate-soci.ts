#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EcsFargateSociStack } from '../lib/ecs-fargate-soci';
import { Aspects } from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

const app = new cdk.App();
const stack = new EcsFargateSociStack(app, 'EcsFargateSociStack', {
  env: {  region: 'ca-central-1' },
  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
});

// Create an Aspect to apply removal policy
class ApplyRemovalPolicy implements cdk.IAspect {
  public visit(node: IConstruct): void {  
    if (node instanceof cdk.CfnResource) {
      node.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
    }
  }
}

// Apply the aspect to the entire stack
Aspects.of(stack).add(new ApplyRemovalPolicy());

app.synth();