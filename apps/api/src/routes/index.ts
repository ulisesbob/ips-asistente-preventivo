import { Router } from 'express';
import { authRouter } from './auth.routes';
import { patientRouter } from './patient.routes';

const router = Router();

router.use('/api/auth', authRouter);
router.use('/api/patients', patientRouter);

export { router };
