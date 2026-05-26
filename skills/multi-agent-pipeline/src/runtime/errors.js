export class ContractValidationError extends Error {
  constructor(artifactName, message) {
    super(`${artifactName} validation failed: ${message}`);
    this.name = "ContractValidationError";
    this.artifactName = artifactName;
  }
}

export class StageExecutionError extends Error {
  constructor(stage, message, options = {}) {
    super(`${stage} stage failed: ${message}`, options);
    this.name = "StageExecutionError";
    this.stage = stage;
  }
}

export class PipelineRejectedError extends Error {
  constructor(message, { restartFrom = "execution", details = null } = {}) {
    super(message);
    this.name = "PipelineRejectedError";
    this.restartFrom = restartFrom;
    this.details = details;
  }
}

export class PipelinePauseForHumanError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "PipelinePauseForHumanError";
    this.restartFrom = "merge";
    this.details = details;
  }
}
