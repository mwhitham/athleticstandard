/** Raised when there is nothing to predict against, or no model to call. */
export class PredictRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PredictRefusal";
  }
}
