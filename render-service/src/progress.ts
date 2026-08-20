export function shouldLogRenderProgress(percent: number, lastLoggedPercent: number): boolean {
  return percent === 100 || (percent % 10 === 0 && percent !== lastLoggedPercent);
}
