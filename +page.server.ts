
import { error, type Actions } from '@sveltejs/kit';

import { createTransport }from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import hubspot, { AssociationTypes } from '@hubspot/api-client';

import {
    SMTP_SERVER,
    SMTP_USERNAME,
    SMTP_PASSWORD,
    SMTP_FROM,
    SMTP_PORT,
    SMTP_RCPT,
    SMTP_SUBJECT,
    HCAPTCHA_SECRET_KEY,
    HCAPTCHA_VERIFY_API,
    HUBSPOT_APP_TOKEN,
    HUBSPOT_CONTACT_OWNER,
} from '$env/static/private';
import type { ApiException } from '@hubspot/api-client/lib/codegen/communication_preferences';

const hubspotClient = new hubspot.Client({ accessToken: HUBSPOT_APP_TOKEN });

const validateCaptcha = (token: string) => {
    const hcaptchaBody = new FormData();

    hcaptchaBody.append('secret', HCAPTCHA_SECRET_KEY);
    hcaptchaBody.append('response', token);

    return fetch(HCAPTCHA_VERIFY_API, {
        method: 'POST',
        body: hcaptchaBody,
    }).then(
        res => res.json()
    );
}

const sendMailPromise = (mailOptions: Mail.Options) => {
    const transport = createTransport({
        host: SMTP_SERVER,
        port: Number(SMTP_PORT),
        secure: true,
        authMethod: 'LOGIN',
        auth: {
            user: SMTP_USERNAME,
            pass: SMTP_PASSWORD,
        }
    });

    return new Promise<SMTPTransport.SentMessageInfo>(
        (resolve, reject) => {
            transport.sendMail(
                mailOptions, 
                (err, info) => {
                    if (err) reject(err);
                    resolve(info);
                }
            );
        }
    );
}

const createContactAndCompany = async ({ name, company, phone, email }: {
    name?: string,
    company?: string,
    phone?: string,
    email?: string,
}) => {
    if (!name || !email) return;

    const nameParts = name.split(' ');

    const firstname = nameParts.slice(0, -1).join(' ');
    const lastname = nameParts.slice(-1).at(0) || '';

    const contactObj: { properties: Record<string, string> }= {
        properties: {
            firstname,
            lastname,
            email,
        },
    }

    if (phone) contactObj.properties.phone = phone;

    let createContactResponse;
    try {
        createContactResponse = await hubspotClient.crm.contacts.basicApi.create(contactObj);
    } catch (e) {
        const error = e as any;
        if (error?.code === 409) {
            return;
        }
        throw e;
    }
    
    /*
    if (!company) return;

    const forbiddenDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'roadrunner.com', 'googlemail.com', 'rocketmail.com'];

    const companyObj: { properties: Record<string, string> }= {
        properties: {
            name: company,
        },
    }

    const domain = email.split('@')[1];
    if (!forbiddenDomains.includes(domain)) companyObj.properties.domain = domain;

    const createCompanyResponse = await hubspotClient.crm.companies.basicApi.create(companyObj)

    await hubspotClient.crm.companies.associationsApi.create(
        parseInt(createCompanyResponse.id),
        'contacts',
        parseInt(createContactResponse.id),
        [
            {
                  "associationCategory": "HUBSPOT_DEFINED",
                  "associationTypeId": AssociationTypes.companyToContact 
                  // AssociationTypes contains the most popular HubSpot defined association types
            }
        ]
    )
    */
}

export const actions: Actions = {
    default: async (event) => {

        const data = await event.request.formData();
        
        const hcaptchaResponse = data.get('hcaptchaResponse');
        data.delete('hcaptchaResponse');

        if (!hcaptchaResponse) {
            throw error(401, 'Bad captcha');
        }

        const hcaptchaStatus = await validateCaptcha(hcaptchaResponse.toString());

        if (!hcaptchaStatus.success) {
            throw error(401, 'Bad captcha');
        }

        const html = Array.from(data.entries()).map(
            ([key, value]) => {
                if (key === 'message') {
                    return `<br><br>${value}`;
                } else {
                    return `<b>${key[0].toUpperCase() + key.slice(1)}</b>: ${value}<br>`;
                }
            }
        ).join('\n');
        
        const fromName = data.get('name')?.toString() || 'Contact Form';
        const replyToAddress = data.get('email')?.toString() || SMTP_FROM;

        await Promise.all([
            sendMailPromise(
                {
                    from: `${fromName} <${SMTP_FROM}>`,
                    to: SMTP_RCPT,
                    subject: SMTP_SUBJECT,
                    headers: {
                        'Reply-To': `${fromName} <${replyToAddress}>`,
                    },
                    html,
                }
            ),
            createContactAndCompany({
                name: fromName,
                company: data.get('company')?.toString(),
                phone: data.get('phone')?.toString(),
                email: data.get('email')?.toString(),
            })
        ]).catch(
            (e) => { 
                console.log(e);
                throw error(500, 'Server Error')
            }
        )
    }
}