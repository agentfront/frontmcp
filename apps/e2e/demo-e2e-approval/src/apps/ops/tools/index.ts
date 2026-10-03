import ApproveDeployTool from './approve-deploy.tool';
import ApproveRotateKeysTool from './approve-rotate-keys.tool';
import DeployServiceTool from './deploy-service.tool';
import DeploymentLogTool from './deployment-log.tool';
import RotateKeysTool from './rotate-keys.tool';

export const opsTools = [
  DeployServiceTool,
  ApproveDeployTool,
  DeploymentLogTool,
  RotateKeysTool,
  ApproveRotateKeysTool,
];
