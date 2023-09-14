import { KubernetesObject } from '@kubernetes/client-node';

export interface GmailAddress extends KubernetesObject {
    spec: GmailAddressSpec;
    status: GmailAddressStatus;
}

export interface GmailAddressSpec {
    address: string;
    parentLabel?: string;
}

export interface GmailAddressStatus {
    observedGeneration?: number;
}