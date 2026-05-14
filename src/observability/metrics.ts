interface CounterMap {
  [name: string]: number;
}

interface HistogramMap {
  [name: string]: number[];
}

export class MetricsRegistry {
  private readonly counters: CounterMap = {};

  private readonly histograms: HistogramMap = {};

  public inc(name: string, value = 1): void {
    this.counters[name] = (this.counters[name] ?? 0) + value;
  }

  public observe(name: string, value: number): void {
    if (!this.histograms[name]) {
      this.histograms[name] = [];
    }
    this.histograms[name].push(value);
  }

  public snapshot(): { counters: CounterMap; histograms: HistogramMap } {
    return {
      counters: { ...this.counters },
      histograms: Object.fromEntries(
        Object.entries(this.histograms).map(([key, values]) => [key, [...values]])
      )
    };
  }
}
