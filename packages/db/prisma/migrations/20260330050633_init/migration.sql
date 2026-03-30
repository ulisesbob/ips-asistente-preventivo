-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'DOCTOR');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('M', 'F', 'OTRO');

-- CreateEnum
CREATE TYPE "RegisteredVia" AS ENUM ('PANEL', 'BOT', 'IMPORT');

-- CreateEnum
CREATE TYPE "PatientProgramStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateTable
CREATE TABLE "doctors" (
    "id" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'DOCTOR',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_programs" (
    "id" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "assignedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "dni" TEXT NOT NULL,
    "phone" TEXT,
    "birthDate" DATE,
    "gender" "Gender",
    "consent" BOOLEAN NOT NULL DEFAULT true,
    "registeredVia" "RegisteredVia" NOT NULL DEFAULT 'PANEL',
    "whatsappLinked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reminderFrequencyDays" INTEGER NOT NULL,
    "templateMessage" TEXT NOT NULL,
    "centers" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_programs" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "enrolledAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enrolledByDoctorId" UUID NOT NULL,
    "lastControlDate" DATE,
    "nextReminderDate" DATE NOT NULL,
    "status" "PatientProgramStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "patient_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "scheduledFor" DATE NOT NULL,
    "sentAt" TIMESTAMPTZ,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "patientReplied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "patientId" UUID,
    "phone" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "doctors_email_key" ON "doctors"("email");

-- CreateIndex
CREATE INDEX "doctor_programs_doctorId_idx" ON "doctor_programs"("doctorId");

-- CreateIndex
CREATE INDEX "doctor_programs_programId_idx" ON "doctor_programs"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_programs_doctorId_programId_key" ON "doctor_programs"("doctorId", "programId");

-- CreateIndex
CREATE UNIQUE INDEX "patients_dni_key" ON "patients"("dni");

-- CreateIndex
CREATE UNIQUE INDEX "patients_phone_key" ON "patients"("phone");

-- CreateIndex
CREATE INDEX "patients_phone_idx" ON "patients"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "programs_name_key" ON "programs"("name");

-- CreateIndex
CREATE INDEX "patient_programs_patientId_idx" ON "patient_programs"("patientId");

-- CreateIndex
CREATE INDEX "patient_programs_programId_idx" ON "patient_programs"("programId");

-- CreateIndex
CREATE INDEX "patient_programs_enrolledByDoctorId_idx" ON "patient_programs"("enrolledByDoctorId");

-- CreateIndex
CREATE INDEX "patient_programs_nextReminderDate_idx" ON "patient_programs"("nextReminderDate");

-- CreateIndex
CREATE INDEX "patient_programs_status_nextReminderDate_idx" ON "patient_programs"("status", "nextReminderDate");

-- CreateIndex
CREATE UNIQUE INDEX "patient_programs_patientId_programId_key" ON "patient_programs"("patientId", "programId");

-- CreateIndex
CREATE INDEX "reminders_patientId_idx" ON "reminders"("patientId");

-- CreateIndex
CREATE INDEX "reminders_programId_idx" ON "reminders"("programId");

-- CreateIndex
CREATE INDEX "reminders_status_scheduledFor_idx" ON "reminders"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "conversations_patientId_idx" ON "conversations"("patientId");

-- CreateIndex
CREATE INDEX "conversations_phone_idx" ON "conversations"("phone");

-- CreateIndex
CREATE INDEX "conversations_status_idx" ON "conversations"("status");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_conversationId_idx" ON "messages"("conversationId");

-- AddForeignKey
ALTER TABLE "doctor_programs" ADD CONSTRAINT "doctor_programs_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_programs" ADD CONSTRAINT "doctor_programs_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_programs" ADD CONSTRAINT "patient_programs_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_programs" ADD CONSTRAINT "patient_programs_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_programs" ADD CONSTRAINT "patient_programs_enrolledByDoctorId_fkey" FOREIGN KEY ("enrolledByDoctorId") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
