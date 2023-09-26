import express from "express";
import dotenv from "dotenv";
import { env } from "process";
import multer from "multer";
import { createTransport } from "nodemailer";
import Mail from "nodemailer/lib/mailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";

dotenv.config();

const app = express();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: Number(env.MAX_UPLOAD_SIZE_MB || 1) * 1024 * 1024,
    },
});

const sendMailPromise = (mailOptions: Mail.Options) => {
    if (!env.SMTP_SERVER) throw new Error("SMTP_SERVER is not defined");
    if (!env.SMTP_FROM) throw new Error("SMTP_FROM is not defined");
    if (!env.SMTP_PORT) throw new Error("SMTP_PORT is not defined");
    if (!env.SMTP_USERNAME) throw new Error("SMTP_USERNAME is not defined");
    if (!env.SMTP_PASSWORD) throw new Error("SMTP_PASSWORD is not defined");

    const transport = createTransport({
        host: env.SMTP_SERVER,
        port: Number(env.SMTP_PORT),
        secure: true,
        authMethod: 'LOGIN',
        auth: {
            user: env.SMTP_USERNAME,
            pass: env.SMTP_PASSWORD,
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

const validateCaptcha = (token: string) => {
    if (!env.HCAPTCHA_SECRET_KEY) throw new Error("HCAPTCHA_SECRET_KEY is not defined");
    if (!env.HCAPTCHA_VERIFY_API) throw new Error("HCAPTCHA_VERIFY_API is not defined");

    const hcaptchaBody = new FormData();

    hcaptchaBody.append('secret', env.HCAPTCHA_SECRET_KEY);
    hcaptchaBody.append('response', token);

    return fetch(env.HCAPTCHA_VERIFY_API, {
        method: 'POST',
        body: hcaptchaBody,
    }).then(
        res => res.json()
    );
}

app.post("/submit", upload.single(env.FILE_UPLOAD_FIELD_KEY || 'file'), async (req, res) => {
    if (env.HCAPTCHA_ENABLED) {
        const { "h-captcha-response": token } = req.body;

        const result = await validateCaptcha(token);
        if (!result.success) {
            res.status(400).send({ error: "Invalid captcha" });
            return;
        }
    }

    const html = Array.from(Object.entries(req.body)).map(
        ([key, value]) => {
            if (key === 'message') {
                return `<br><br>${value}`;
            } else {
                return `<b>${key[0].toUpperCase() + key.slice(1)}</b>: ${value}<br>`;
            }
        }
    ).join('\n');

    const fromName = req.body.name?.toString() || 'Contact Form';
    const replyToAddress = req.body.email?.toString() || env.SMTP_FROM!;

    await sendMailPromise(
        {
            from: `${fromName} <${env.SMTP_FROM}>`,
            to: env.SMTP_RCPT,
            subject: env.SMTP_SUBJECT,
            headers: {
                'Reply-To': `${fromName} <${replyToAddress}>`,
            },
            html,
            attachments: req.file ? [
                {
                    filename: req.file.originalname,
                    content: req.file.buffer,
                }
            ] : undefined,
        }
    ).catch(
        (e) => res.status(500).send({ error: e.message })
    );

    res.status(200).send({ success: true });
});