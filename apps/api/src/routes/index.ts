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
import { medicationReminderRouter } from './medication-reminder.routes';

const router = Router();

router.use('/api/auth', authRouter);
router.use('/api/patients', patientRouter);
router.use('/api/patients', noteRouter);
router.use('/api/programs', programRouter);
router.use('/api/doctors', doctorRouter);
router.use('/api/conversations', conversationRouter);
router.use('/api/dashboard', dashboardRouter);
router.use('/api/knowledge', knowledgeRouter);
router.use('/api', medicationReminderRouter);
// Patient-program routes mounted at /api (paths include /patients/:patientId/programs and /patient-programs/:id)
router.use('/api', patientProgramRouter);
// WhatsApp webhook (no auth — Meta calls this directly)
router.use('/api', whatsappRouter);

export { router };
