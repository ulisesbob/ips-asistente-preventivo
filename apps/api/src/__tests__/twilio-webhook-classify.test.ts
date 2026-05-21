import { describe, it, expect } from 'vitest';
import { classifyTwilioWebhook } from '../routes/twilio.routes';

// Blinda la clasificación del webhook de Twilio. El bug que cierra: un status
// callback (delivered/read) de un mensaje saliente CON media disparaba por error
// la respuesta "solo texto" al paciente.
describe('classifyTwilioWebhook', () => {
  const FROM = 'whatsapp:+5493764123456';

  it('status callback (MessageStatus) = status, aunque traiga NumMedia', () => {
    expect(
      classifyTwilioWebhook({ MessageStatus: 'delivered', MessageSid: 'SM1', From: FROM, NumMedia: '1' })
    ).toBe('status');
  });

  it('status callback con SmsStatus = status', () => {
    expect(classifyTwilioWebhook({ SmsStatus: 'read', MessageSid: 'SM2', From: FROM })).toBe('status');
  });

  it('mensaje de texto entrante = text', () => {
    expect(classifyTwilioWebhook({ MessageSid: 'SM3', From: FROM, Body: 'hola' })).toBe('text');
  });

  // REGRESIÓN que tiró el bot entero: Twilio manda SmsStatus="received" en TODO
  // mensaje ENTRANTE. Antes (clasificar por presencia) caía en 'status' y se
  // descartaban TODOS los mensajes del paciente. Debe ser 'text'.
  it('inbound REAL de Twilio (SmsStatus=received) con texto = text', () => {
    expect(
      classifyTwilioWebhook({ SmsStatus: 'received', MessageSid: 'SM3b', From: FROM, Body: 'hola', NumMedia: '0' })
    ).toBe('text');
  });

  it('inbound REAL (SmsStatus=received) sin texto con media = unsupported', () => {
    expect(
      classifyTwilioWebhook({ SmsStatus: 'received', MessageSid: 'SM3c', From: FROM, NumMedia: '1', Body: '' })
    ).toBe('unsupported');
  });

  it('audio/imagen sin body (NumMedia>0) = unsupported', () => {
    expect(classifyTwilioWebhook({ MessageSid: 'SM4', From: FROM, NumMedia: '1', Body: '' })).toBe('unsupported');
  });

  it('no-texto sin NumMedia ni location también = unsupported (por descarte)', () => {
    expect(classifyTwilioWebhook({ MessageSid: 'SM5', From: FROM })).toBe('unsupported');
  });

  it('body de solo espacios = unsupported (no es texto útil)', () => {
    expect(classifyTwilioWebhook({ MessageSid: 'SM6', From: FROM, Body: '   ' })).toBe('unsupported');
  });

  it('sin MessageSid o sin From = ignore', () => {
    expect(classifyTwilioWebhook({ Body: 'hola' })).toBe('ignore');
    expect(classifyTwilioWebhook({ MessageSid: 'SM7', Body: 'hola' })).toBe('ignore');
  });
});
