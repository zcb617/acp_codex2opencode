import type { Logger } from "./logger.js";

interface AlertRule {
  name: string;
  threshold: number;
  level: "P1" | "P2";
}

export class AlertEvaluator {
  private readonly logger: Logger;

  public constructor(logger: Logger) {
    this.logger = logger;
  }

  public evaluateRate(name: string, value: number, rule: AlertRule): void {
    if (value >= rule.threshold) {
      this.logger.warn("alert.triggered", {
        alert: name,
        severity: rule.level,
        value,
        threshold: rule.threshold
      });
    }
  }
}
