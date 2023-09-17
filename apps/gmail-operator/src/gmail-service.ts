import { google } from 'googleapis';
import { JWT } from 'google-auth-library';


export default class GmailService {

    private scopes = [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/gmail.labels',
        'https://www.googleapis.com/auth/gmail.settings.basic',
    ];

    private client: any;

    async init(email: string): Promise<void> {
        if (this.client) return;
        
        this.client = new JWT({
            email,
            keyFile: 'credentials/credentials.json',
            scopes: this.scopes,
            subject: email
        });

        this.client.authorize((err: any, tokens: any) => {
            if (err) {
                console.log(err);
                return;
            }

            console.log('Connected to Gmail API');
        });
    }

    async getLabels(): Promise<any> {
        const gmail = google.gmail({ version: 'v1', auth: this.client });

        const response = await gmail.users.labels.list({
            userId: 'me',
        });

        return response.data.labels;
    }

    async getLabel(labelName: string): Promise<any> {
        const labels = await this.getLabels();
        return labels.find((label: any) => label.name === labelName);
    }

    async createLabel(labelName: string): Promise<any> {
        const gmail = google.gmail({ version: 'v1', auth: this.client });

        const response = await gmail.users.labels.create({
            userId: 'me',
            requestBody: {
                name: labelName,
                labelListVisibility: 'labelShow',
                messageListVisibility: 'show',
            },
        });

        return response.data;
    }

    async deleteLabel(labelId: string): Promise<any> {
        const gmail = google.gmail({ version: 'v1', auth: this.client });

        const response = await gmail.users.labels.delete({
            userId: 'me',
            id: labelId,
        });

        return response.data;
    }

    async hasLabel(labelName: string): Promise<boolean> {
        const labels = await this.getLabels();
        return labels.some((label: any) => label.name === labelName);
    }

    async createFilter(filter: any): Promise<any> {
        const gmail = google.gmail({ version: 'v1', auth: this.client });

        const response = await gmail.users.settings.filters.create({
            userId: 'me',
            requestBody: filter,
        });

        return response.data;
    }

    async deleteFilter(filterId: string): Promise<any> {
        const gmail = google.gmail({ version: 'v1', auth: this.client });

        const response = await gmail.users.settings.filters.delete({
            userId: 'me',
            id: filterId,
        });

        return response.data;
    }

    async getFilters(): Promise<any> {
        const gmail = google.gmail({ version: 'v1', auth: this.client });

        const response = await gmail.users.settings.filters.list({
            userId: 'me',
        });

        return response.data.filter;
    }

    async hasFilter(address: string): Promise<boolean> {
        const filters = await this.getFilters();
        return filters.find((filter: any) => filter.criteria.from === address);
    }

    async getFilter(address: string): Promise<any> {
        const filters = await this.getFilters();
        return filters.find((filter: any) => filter.criteria.from === address);
    }

}