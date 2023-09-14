import { skip, suite, test } from '@testdeck/mocha';
import * as _chai from 'chai';
import { mock, instance, when } from 'ts-mockito';
import GmailService from '../src/gmail-service.ts';

const expect = _chai.expect;
const mocked = process.env.NODE_ENV === 'mocked';

@suite
class GmailServiceTests {

    private gmailService: GmailService;
    private mockedGmailService: GmailService;

    async before() {
        this.gmailService = new GmailService();
        this.mockedGmailService = mock(GmailService);

        if (!mocked) await this.gmailService.init();
    }

    @test 
    async 'should return a list of labels'() {
        when(this.mockedGmailService.getLabels()).thenResolve({
            labels: [
                { id: 'SENT', name: 'SENT', type: 'system' },
                { id: 'INBOX', name: 'INBOX', type: 'system' },
                { id: 'TEST', name: 'TEST', type: 'user' },
            ]
        });

        const client = instance(this.mockedGmailService);

        const labels = await client.getLabels();
        expect(labels).to.have.property('labels').with.lengthOf(3);
    }

    @test
    async 'can create label'() {
        const label = await this.gmailService.createLabel('test-label');
        expect(label).to.have.property('name').equal('test-label');
    }

    @test
    async 'can delete label'() {
        if ((await this.gmailService.hasLabel('test-label')) == false) {
            await this.gmailService.createLabel('test-label');
        }
        const label = await this.gmailService.getLabel('test-label');
        const result = await this.gmailService.deleteLabel(label.id);
        expect(result).to.be.empty;
    }

    @test
    async 'can check if label exists'() {
        if ((await this.gmailService.hasLabel('test-label')) == false) {
            await this.gmailService.createLabel('test-label');
        }
        expect(await this.gmailService.hasLabel('test-label')).to.be.true;
    }

    @test
    async 'can check if label does not exist'() {
        if ((await this.gmailService.hasLabel('test-label')) == true) {
            const label = await this.gmailService.getLabel('test-label');
            await this.gmailService.deleteLabel(label.id);
        }
        expect(await this.gmailService.hasLabel('test-label')).to.be.false;
    }
}