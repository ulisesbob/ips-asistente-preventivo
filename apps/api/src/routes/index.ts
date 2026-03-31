import { Router } from 'express';
import { authRouter } from './auth.routes';
import { patientRouter } from './patient.routes';
import { noteRouter } from './note.routes';
import { programRouter, patientProgramRouter } from './program.routes';
import { doctorRouter } from './doctor.routes';
import { conversationRouter } from './conversation.routes';
import { whatsappRouter } from './whatsapp.routes';
import { dashboardRouter } from './dashboard.routes';
import { knowledgeRouter } from './knowledge.routes';

const router = Router();

router.use('/api/auth', authRouter);
router.use('/api/patients', patientRouter);
router.use('/api/patients', noteRouter);
router.use('/api/programs', programRouter);
router.use('/api/doctors', doctorRouter);
router.use('/api/conversations', conversationRouter);
router.use('/api/dashboard', dashboardRouter);
router.use('/api/knowledge', knowledgeRouter);
// Patient-program routes mounted at /api (paths include /patients/:patientId/programs and /patient-programs/:id)
router.use('/api', patientProgramRouter);
// WhatsApp webhook (no auth — Meta calls this directly)
router.use('/api', whatsappRouter);

// ─── TEMPORAL: seed knowledge base en producción ─────────────────────────────
// BORRAR después de ejecutar una vez
import { prisma } from '@ips/db';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/error-handler';

router.post('/api/admin/seed-kb', requireAuth, requireAdmin, asyncHandler(async (_req, res) => {
  const kbData = [
    { category: 'Coberturas', question: '¿Qué cubre el IPS?', answer: 'El IPS brinda cobertura a 180.503 afiliados bajo el PMO. Cubre: consultas médicas (Nivel I), especialistas y ecografías (Nivel II), resonancia magnética, tomografía y cirugías cardiovasculares (Nivel III). También cubre internación 100% (medicamentos y descartables incluidos), diálisis 100%, trasplantes 100% (pre y post), prótesis y órtesis 100%, implantes cocleares, y servicios fúnebres 100%. Libre elección de prestadores sin derivación previa.', sortOrder: 1 },
    { category: 'Coberturas', question: '¿El IPS cubre lentes/anteojos?', answer: 'Sí, el IPS cubre lentes de contacto, lentes bifocales y armazones sobre valores establecidos. Necesitás receta del oftalmólogo del IPS. El trámite se hace en la Obra Social (Junín 1563, Posadas).', sortOrder: 2 },
    { category: 'Coberturas', question: '¿El IPS cubre prótesis y órtesis?', answer: 'Sí, cobertura del 100% en prótesis y órtesis, tanto nacionales como importadas. Necesitás orden del especialista del IPS y autorización de Auditoría Médica.', sortOrder: 3 },
    { category: 'Coberturas', question: '¿Cómo retiro medicamentos?', answer: 'Los medicamentos se retiran en la Farmacia del IPS (Junín 177, Posadas, tel. 0376-444-8684) o en las bocas de expendio de tu delegación, con receta del médico del IPS. Los programas crónicos (Diabetes, Hipertensión) tienen medicación 100% gratuita. Genéricos con hasta 40% de descuento.', sortOrder: 4 },
    { category: 'Coberturas', question: '¿El IPS cubre cirugías?', answer: 'Sí, el IPS cubre cirugías programadas y de urgencia en sanatorios y clínicas prestadoras, y en hospitales públicos de la provincia mediante órdenes médicas. Para cirugías programadas necesitás autorización previa de Auditoría Médica.', sortOrder: 5 },
    { category: 'Coberturas', question: '¿El IPS cubre trasplantes?', answer: 'Sí, cobertura 100% en tratamiento pre y post trasplante de médula, riñón, hígado y córnea.', sortOrder: 6 },
    { category: 'Coberturas', question: '¿El IPS cubre salud mental?', answer: 'Sí, el IPS cubre kinesioterapia, psicología, nutrición, y atención especializada en salud mental y discapacidad.', sortOrder: 7 },
    { category: 'Coberturas', question: '¿El IPS cubre diálisis?', answer: 'Sí, cobertura 100% en centros de diálisis de Posadas, Oberá y Eldorado.', sortOrder: 8 },
    { category: 'Trámites', question: '¿Cómo saco turno con un especialista?', answer: 'El IPS tiene libre elección de prestadores sin necesidad de derivación previa. Podés acceder directo al especialista con bono de consulta. Policonsultorio IPS: Junín 1779, Posadas, tel. 0376-444-8750. También podés llamar al 0800-888-0109.', sortOrder: 1 },
    { category: 'Trámites', question: '¿Qué necesito para hacerme estudios de laboratorio?', answer: 'Necesitás: (1) Orden médica del IPS, (2) DNI, (3) Carnet de afiliado. Para análisis de sangre: ir en ayunas. Laboratorio Central IPS: Ayacucho 270, Posadas, tel. 0376-444-8692 / 0376-444-8620.', sortOrder: 2 },
    { category: 'Trámites', question: '¿Cómo me afilio al IPS?', answer: 'Las afiliaciones se tramitan en San Martín 2133, Posadas, tel. 0376-444-8639. Necesitás DNI, recibo de sueldo y documentación del grupo familiar.', sortOrder: 3 },
    { category: 'Trámites', question: '¿Dónde retiro las chequeras de los programas?', answer: 'Las chequeras de todos los programas especiales se retiran en el Área de Programas Especiales, planta baja del edificio central (Junín 177, Posadas) o en las delegaciones provinciales.', sortOrder: 5 },
    { category: 'Programas', question: '¿Qué es el programa de Diabetes?', answer: 'Programa para afiliados con diagnóstico de diabetes. 3 tipos de chequera: Tipo I (insulinodependientes), Tipo II (hipoglucemiantes orales), Tipo III (insulino-requerientes). Incluye: 6 consultas médico cabecera, 6 diabetólogo, 2 controles de pie, 2 cardiología, 2 oftalmología, 1 nutricionista, 6 análisis, 12 retiros medicamentos. 100% insulina, hipoglucemiantes y tiras reactivas. 80% descartables.', sortOrder: 1 },
    { category: 'Programas', question: '¿Qué es el programa Mujer Sana?', answer: 'Prevención y detección de cáncer de mama y útero. Para afiliadas desde 40 años (o menores con antecedentes). Cobertura 100%: consulta ginecológica, colposcopía, mamografía + ecografía, PAP, detección HPV. Retirá la chequera en Programas Especiales (Junín 177) o delegaciones.', sortOrder: 2 },
    { category: 'Programas', question: '¿Qué es el programa Hombre Sano?', answer: 'Prevención de enfermedades de próstata. Para afiliados desde 45 años. Incluye: 1 consulta médico cabecera, 1 análisis bioquímico, 1 ecografía renal y prostática, 2 consultas urológicas.', sortOrder: 3 },
    { category: 'Programas', question: '¿Qué es PREDHICAR?', answer: 'Control de hipertensión arterial. Para afiliados desde 40 años. La chequera incluye: 4 consultas cardiología, 2 análisis bioquímicos, 1 hoja indicaciones médicas, 12 órdenes retiro medicamentos.', sortOrder: 4 },
    { category: 'Programas', question: '¿Qué es el programa Oncológico?', answer: 'Atención integral al paciente oncológico. Requiere historia clínica/biopsia. Incluye: 9 órdenes apoyo psicológico, 1 apoyo familiar, 1 tratamiento del dolor, 1 drenaje linfático post-quirúrgico mama.', sortOrder: 5 },
    { category: 'Programas', question: '¿Qué es el Plan Materno Infantil?', answer: 'PRE-NATAL: 7 consultas obstetra, 3 análisis trimestrales, 3 ecografías, 3 nutricionista, 1 cardiología+ECG, 1 monitoreo fetal, 1 odontología, 7 recetarios. POST-PARTO: 4 consultas, 100% internación hasta 60 días. CONTROL NIÑO hasta 2 años: 18 consultas pediatra, 6 análisis, 2 radiografías.', sortOrder: 6 },
    { category: 'Programas', question: '¿Qué es el programa de Celíacos?', answer: 'Para afiliados de todas las edades con celiaquía confirmada. Incluye: 1 consulta cabecera, 1 análisis, 2 gastroenterólogo, 1 nutricionista, 1 plan alimentario, 12 cajas alimentarias gratuitas, 2 recetarios.', sortOrder: 7 },
    { category: 'Programas', question: '¿Qué es el programa de Osteoporosis?', answer: 'Densitometría ósea gratuita para afiliados desde 50 años. Centros en Eldorado, Puerto Rico, Oberá y Posadas. Retirá chequera en Programas Especiales o delegaciones.', sortOrder: 8 },
    { category: 'Programas', question: '¿Qué es el programa de Cáncer de Colon?', answer: 'Detección temprana para hombres y mujeres desde 45 años. Análisis de sangre oculta en materia fecal gratuito anualmente. Retirá chequera en Programas Especiales (Junín 1563) o delegaciones.', sortOrder: 9 },
    { category: 'Programas', question: '¿Cómo pido el Kit del Recién Nacido?', answer: 'En IPS Programas Especiales (2do piso, Bolívar 2152, tel. 0376-444-8707) o delegaciones. Llevá: carnet afiliado, recibo haberes, DNI titular y recién nacido, partida nacimiento, papel rosado (original y copia).', sortOrder: 10 },
    { category: 'Contacto', question: '¿Dónde queda la sede central del IPS?', answer: 'Sede Central: Bolívar 2152, Posadas, tel. 0376-444-8653. Obra Social: Junín 1563, tel. 0376-444-8631. Policonsultorio: Junín 1779, tel. 0376-444-8750. Farmacia: Junín 177, tel. 0376-444-8684. Laboratorio: Ayacucho 270, tel. 0376-444-8692.', sortOrder: 1 },
    { category: 'Contacto', question: '¿Cuáles son los horarios de atención?', answer: 'Sede Central: lunes a viernes 9:00 a 17:00. Delegaciones Posadas (Itaembé Guazú, Villa Cabello, Parque de la Salud): 7:00 a 19:00. Bocas de expendio: 7:00 a 13:00. Línea 0800-888-0109.', sortOrder: 2 },
    { category: 'Contacto', question: '¿Dónde hay delegaciones del IPS en Posadas?', answer: 'Itaembé Guazú (Hospital): Las Orquídeas 10633, tel. 0376-155087373. Villa Cabello: Chacra 149, Fermín Fierro, tel. 0376-4448020. Parque de la Salud (Hospital Madariaga): Av. López Torres 3568, tel. 0376-4434172.', sortOrder: 3 },
    { category: 'Contacto', question: '¿Dónde hay delegaciones del IPS en el interior?', answer: 'Oberá: San Martín 773, cel. 3755-751323. Eldorado: Pionero Ziegler 232, WA 3751635433. Puerto Iguazú: Córdoba y Bompland, tel. 03757-420154. 60 centros en toda la provincia. Consultá al 0376-444-6611.', sortOrder: 4 },
    { category: 'Contacto', question: '¿Cómo contacto al IPS?', answer: 'Línea gratuita: 0800-888-0109. Sede: Bolívar 2152, Posadas, tel. 0376-444-8653. Email: departamentosanatorialips@gmail.com. Delegaciones: 0376-444-6611. Programas Especiales: 0376-444-8707.', sortOrder: 5 },
    { category: 'Urgencias', question: '¿Qué hago en una emergencia?', answer: 'Llamá al 107 (SAME) o andá a la guardia más cercana. Presentá DNI y carnet. Internación 100% cubierta. Reintegro disponible si te atienden fuera de la red (con autorización previa de Auditoría Médica).', sortOrder: 1 },
    { category: 'Urgencias', question: '¿El IPS cubre ambulancia?', answer: 'Sí, traslado en ambulancia dentro de la provincia para emergencias y derivaciones. Coordiná desde la guardia o al 0800-888-0109.', sortOrder: 2 },
    { category: 'Urgencias', question: '¿El IPS tiene oxigenoterapia domiciliaria?', answer: 'Sí, con prescripción del especialista y autorización de Auditoría Médica.', sortOrder: 3 },
  ];

  let created = 0;
  for (const kb of kbData) {
    const existing = await prisma.knowledgeBase.findFirst({
      where: { category: kb.category, question: kb.question },
    });
    if (existing) {
      await prisma.knowledgeBase.update({ where: { id: existing.id }, data: { answer: kb.answer, sortOrder: kb.sortOrder } });
    } else {
      await prisma.knowledgeBase.create({ data: kb });
      created++;
    }
  }

  res.json({ status: 'ok', data: { created, updated: kbData.length - created, total: kbData.length } });
}));

export { router };
