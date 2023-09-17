import Operator, { ResourceEvent, ResourceEventType } from '@dot-i/k8s-operator';
import path from 'node:path';
import { GmailAddress } from './gmail-address';
import GmailService from './gmail-service';
import MetricService from './metric-service';

export default class GmailAddressOperator extends Operator {

    private gmailService: GmailService;
    private metricService: MetricService;

    constructor(app: any) {
        super();
        this.gmailService = new GmailService();
        this.metricService = new MetricService(app);
    }

    protected async init(): Promise<void> {
        console.log(`GmailAddressOperator init`);

        await this.gmailService.init(process.env.GMAIL_ADDRESS);

        console.log(`GmailService init done`);

        const crdFile = path.resolve(__dirname, 'crds', 'gmail-address.yaml');
        const { group, versions, plural } = await this.registerCustomResourceDefinition(crdFile);

        await this.watchResource(group, versions[0].name, plural, async (e) => {
            try {
                if (e.type === ResourceEventType.Added || e.type === ResourceEventType.Modified) {
                    if (!await this.handleResourceFinalizer(e, `${plural}.${group}`, (event) => this.resourceDeleted(event))) {
                        await this.resourceModified(e);
                    }
                }
            } catch (err) {
                // Log here...
            }
        });

        console.log(`GmailAddressOperator init done`);
    }

    private async resourceModified(e: ResourceEvent): Promise<void> {
        const object = e.object as GmailAddress;
        const metadata = object.metadata;

        if (!object.status || object.status.observedGeneration !== metadata?.generation) {

            await this.setResourceStatus(e.meta, {
                observedGeneration: metadata?.generation
            });
        }

        const labelName = this.createLabelName(metadata.name, object.spec.parentLabel);
        this.checkParentLabel(labelName);

        const hasLabel = await this.gmailService.hasLabel(labelName);
        console.log(`Label ${labelName} exists: ${hasLabel}`);

        if (!hasLabel) {
            console.log(`Creating label ${labelName}`);

            const label = await this.gmailService.createLabel(labelName);
            console.log('createFilter', await this.gmailService.createFilter({
                action: {
                    addLabelIds: [label.id]
                },
                criteria: {
                    from: object.spec.address
                }
            }));

            this.metricService.inc('gmail_address_operator_labels');
            console.log(`Created label ${labelName}`);
        }

    }

    private async resourceDeleted(e: ResourceEvent): Promise<void> {
        const object = e.object as GmailAddress;
        const metadata = object.metadata;

        const labelName = this.createLabelName(metadata.name, object.spec.parentLabel);
        this.checkParentLabel(labelName);

        const label = await this.gmailService.getLabel(labelName);
        if (label?.id) {
            console.log(`Deleting label ${labelName}`);

            await this.gmailService.deleteLabel(label.id);

            const filter = await this.gmailService.getFilter(object.spec.address);
            if (filter?.id) {
                console.log(`Deleting filter for ${object.spec.address}`);
                console.log('deleteFilter', await this.gmailService.deleteFilter(filter.id));
            }

            this.metricService.dec('gmail_address_operator_labels');
            console.log(`Deleted label ${labelName}`);
        }
    }

    private createLabelName(label: string, parentLabel?: string): string {
        return parentLabel ? `${parentLabel}/${label}` : label;
    }

    private async checkParentLabel(labelName: string): Promise<void> {
        console.log(`Checking parent label for ${labelName}`);
        if (labelName.includes('/')) {
            console.log(`Label ${labelName} has a parent`);

            const parentLabelName = labelName.substring(0, labelName.indexOf('/'));
            const parent = await this.gmailService.hasLabel(parentLabelName);

            console.log(`Parent label ${parentLabelName} exists: ${parent}`);
            if (!parent) {
                await this.gmailService.createLabel(parentLabelName);
            }
        }
    }
}