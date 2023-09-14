import { Prometheus } from '@promster/express';

export default class MetricService {

    private appExpress: any;
    private metrics: { [key: string]: Prometheus.Gauge } = {};

    constructor(app: any) {
        this.appExpress = app;
    }

    async inc(metricName: string): Promise<void> {
        if (!this.metrics[metricName]) {
            this.metrics[metricName] = new this.appExpress.locals.Prometheus.Gauge({
                name: metricName,
                help: metricName
            });
        }

        this.metrics[metricName].inc();
    }

    async dec(metricName: string): Promise<void> {
        if (!this.metrics[metricName]) {
            this.metrics[metricName] = new this.appExpress.locals.Prometheus.Gauge({
                name: metricName,
                help: metricName
            });
        }

        this.metrics[metricName].dec();
    }

}