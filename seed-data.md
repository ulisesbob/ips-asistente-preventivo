# Datos de Seed — Para desarrollo y demo

Estos datos se cargan con `npx prisma db seed`. Son datos FAKE pero realistas para Misiones.

---

## Admin de prueba
| Campo | Valor |
|-------|-------|
| fullName | Dr. Admin IPS |
| email | admin@ips.gob.ar |
| password | Admin2026! |
| role | ADMIN |

## Médicos de prueba (5)
| fullName | email | role | Programas |
|----------|-------|------|-----------|
| Dr. Roberto Fernández | rfernandez@ips.gob.ar | DOCTOR | Diabetes, PREDHICAR |
| Dra. Laura Benítez | lbenitez@ips.gob.ar | DOCTOR | Mujer Sana, Plan Materno Infantil |
| Dr. Carlos Ayala | cayala@ips.gob.ar | DOCTOR | Hombre Sano, Oncológico |
| Dra. María Sosa | msosa@ips.gob.ar | DOCTOR | Osteoporosis, Celíacos |
| Dr. Jorge Méndez | jmendez@ips.gob.ar | DOCTOR | Cáncer de Colon, Oncológico |

Password para todos: Doctor2026!

## 9 Programas oficiales del IPS
| name | reminderFrequencyDays | templateMessage |
|------|-----------------------|-----------------|
| Diabetes | 90 | "Hola {{nombre}}, desde el IPS le recordamos que es momento de realizar su control de hemoglobina glicosilada. Tiene cobertura 100% en el laboratorio del IPS. Para más información, responda a este mensaje." |
| Mujer Sana | 365 | "Hola {{nombre}}, es momento de realizar su mamografía + PAP. La chequera Mujer Sana le cubre estos estudios de forma gratuita. Retírela en Junín 177 o en su delegación." |
| Hombre Sano | 365 | "Hola {{nombre}}, es momento de realizar su control de PSA + ecografía. La chequera Hombre Sano le cubre estos estudios. Retírela en su delegación más cercana." |
| PREDHICAR | 30 | "Hola {{nombre}}, recuerde controlar su presión arterial. Si no tiene tensiómetro, puede acercarse a su delegación o farmacia propia del IPS." |
| Osteoporosis | 365 | "Hola {{nombre}}, es momento de realizar su densitometría ósea anual. Centros habilitados: Eldorado, Puerto Rico, Oberá, Posadas." |
| Oncológico | 90 | "Hola {{nombre}}, le recordamos su control oncológico programado. Tiene cobertura del 100% en prácticas y medicamentos. Consulte con su médico tratante." |
| Celíacos | 365 | "Hola {{nombre}}, es momento de su control anual de celiaquía. Recuerde que tiene cobertura de harinas y productos especiales." |
| Cáncer de Colon | 365 | "Hola {{nombre}}, le recordamos realizar su screening de sangre oculta en materia fecal. Solicite la orden en su delegación." |
| Plan Materno Infantil | 30 | "Hola {{nombre}}, según su calendario prenatal, le corresponde un control esta semana. Tiene cobertura completa de parto y neonatología." |

## Centros de atención (JSON por programa)
```json
{
  "Diabetes": [
    {"city": "Posadas", "name": "Laboratorio Central IPS", "address": "Junín 177"},
    {"city": "Oberá", "name": "Delegación Oberá", "address": "Sarmiento 555"},
    {"city": "Eldorado", "name": "Delegación Eldorado", "address": "San Martín 1200"}
  ],
  "Mujer Sana": [
    {"city": "Posadas", "name": "Hospital Madariaga", "address": "Av. Marconi 3736"},
    {"city": "Oberá", "name": "Hospital SAMIC Oberá", "address": "Eugenio Ramírez s/n"},
    {"city": "Posadas", "name": "Sede Central IPS", "address": "Junín 177"}
  ],
  "Hombre Sano": [
    {"city": "Posadas", "name": "Sede Central IPS", "address": "Junín 177"},
    {"city": "Oberá", "name": "Delegación Oberá", "address": "Sarmiento 555"}
  ],
  "PREDHICAR": [
    {"city": "Posadas", "name": "Farmacia IPS Central", "address": "Junín 177"},
    {"city": "Oberá", "name": "Farmacia IPS Oberá", "address": "Sarmiento 555"},
    {"city": "Eldorado", "name": "Farmacia IPS Eldorado", "address": "San Martín 1200"}
  ],
  "Osteoporosis": [
    {"city": "Posadas", "name": "Centro de Diagnóstico Posadas", "address": "Bolívar 1550"},
    {"city": "Oberá", "name": "Centro de Diagnóstico Oberá", "address": "Bolívar 980"},
    {"city": "Eldorado", "name": "Centro de Diagnóstico Eldorado", "address": "San Martín 800"},
    {"city": "Puerto Rico", "name": "Centro de Diagnóstico Puerto Rico", "address": "Jujuy 450"}
  ],
  "Oncológico": [
    {"city": "Posadas", "name": "Hospital Madariaga - Oncología", "address": "Av. Marconi 3736"},
    {"city": "Posadas", "name": "Farmacia IPS Oncológica", "address": "Junín 177"}
  ],
  "Celíacos": [
    {"city": "Posadas", "name": "Sede Central IPS", "address": "Junín 177"},
    {"city": "Oberá", "name": "Delegación Oberá", "address": "Sarmiento 555"}
  ],
  "Cáncer de Colon": [
    {"city": "Posadas", "name": "Laboratorio Central IPS", "address": "Junín 177"},
    {"city": "Oberá", "name": "Delegación Oberá", "address": "Sarmiento 555"}
  ],
  "Plan Materno Infantil": [
    {"city": "Posadas", "name": "Hospital Madariaga - Maternidad", "address": "Av. Marconi 3736"},
    {"city": "Oberá", "name": "Hospital SAMIC Oberá", "address": "Eugenio Ramírez s/n"}
  ]
}
```

## Pacientes de prueba (50 — datos fake realistas de Misiones)
| fullName | dni | phone | gender | Programas |
|----------|-----|-------|--------|-----------|
| María García López | 28456789 | +5493764123456 | F | Mujer Sana, Diabetes |
| Juan Carlos Rodríguez | 25789012 | +5493764234567 | M | Diabetes, PREDHICAR |
| Ana Beatriz Fernández | 30123456 | +5493764345678 | F | Mujer Sana |
| Roberto Daniel Martínez | 22345678 | +5493764456789 | M | Hombre Sano, PREDHICAR |
| Claudia Inés Benítez | 27890123 | +5493764567890 | F | Osteoporosis, Diabetes |
| Jorge Alberto Sosa | 24567890 | +5493764678901 | M | Oncológico |
| Graciela del Carmen Ayala | 29012345 | +5493764789012 | F | Celíacos |
| Pedro Luis Gómez | 23456789 | +5493764890123 | M | Cáncer de Colon |
| Silvia Noemí López | 31234567 | +5493764901234 | F | Plan Materno Infantil |
| Carlos Eduardo Méndez | 26789012 | +5493765012345 | M | Diabetes, Hombre Sano |
| Rosa María Villalba | 28901234 | +5493765123456 | F | Mujer Sana, PREDHICAR |
| Miguel Ángel Acuña | 21345678 | +5493765234567 | M | PREDHICAR, Oncológico |
| Marta Susana Torres | 33456789 | +5493765345678 | F | Diabetes |
| Diego Armando Pérez | 25012345 | +5493765456789 | M | Hombre Sano |
| Liliana del Valle Duarte | 30567890 | +5493765567890 | F | Osteoporosis |
| Ramón Esteban Cardozo | 22678901 | +5493765678901 | M | Diabetes, PREDHICAR |
| Patricia Alejandra Núñez | 29345678 | +5493765789012 | F | Mujer Sana, Celíacos |
| Héctor Hugo Romero | 24890123 | +5493765890123 | M | Cáncer de Colon |
| Estela Maris Cabrera | 27012345 | +5493765901234 | F | Diabetes, Osteoporosis |
| Fernando Javier Vera | 23789012 | +5493766012345 | M | PREDHICAR |
| Norma Gladys Giménez | 32123456 | +5493766123456 | F | Mujer Sana |
| Raúl Oscar Domínguez | 20456789 | +5493766234567 | M | Hombre Sano, Diabetes |
| Alicia Beatriz Leiva | 28234567 | +5493766345678 | F | Oncológico |
| Daniel Alejandro Báez | 25456789 | +5493766456789 | M | PREDHICAR, Diabetes |
| Mirta Graciela Ortiz | 31678901 | +5493766567890 | F | Plan Materno Infantil |
| Sergio Fabián Ríos | 22901234 | +5493766678901 | M | Cáncer de Colon, PREDHICAR |
| Gladys Noelia Ramírez | 29678901 | +5493766789012 | F | Celíacos, Diabetes |
| José Luis Brítez | 24123456 | +5493766890123 | M | Oncológico, PREDHICAR |
| Teresa del Carmen Sánchez | 27456789 | +5493766901234 | F | Osteoporosis, Mujer Sana |
| Víctor Manuel Alvarez | 23012345 | +5493767012345 | M | Diabetes |
| Irma Beatriz González | 30789012 | +5493767123456 | F | Mujer Sana, PREDHICAR |
| Enrique Adrián Castro | 21678901 | +5493767234567 | M | Hombre Sano |
| Carmen Rosa Medina | 28567890 | +5493767345678 | F | Diabetes, Celíacos |
| Rubén Darío Flores | 25890123 | +5493767456789 | M | PREDHICAR |
| Susana del Valle Amarilla | 32890123 | +5493767567890 | F | Oncológico, Mujer Sana |
| Osvaldo Ramón Krawczyk | 20890123 | +5493767678901 | M | Diabetes, Cáncer de Colon |
| Blanca Nieves Paredes | 29901234 | +5493767789012 | F | Osteoporosis |
| Marcelo Fabián Insaurralde | 24345678 | +5493767890123 | M | PREDHICAR, Diabetes |
| Olga Nélida Riquelme | 27678901 | +5493767901234 | F | Plan Materno Infantil |
| Néstor Fabián Escobar | 23345678 | +5493768012345 | M | Hombre Sano, PREDHICAR |
| Adriana del Pilar Aguirre | 31012345 | +5493768123456 | F | Mujer Sana |
| Walter Hugo Chávez | 22012345 | +5493768234567 | M | Oncológico |
| Mónica Patricia Ledesma | 28678901 | +5493768345678 | F | Diabetes, PREDHICAR |
| Julio César Aquino | 25123456 | +5493768456789 | M | Cáncer de Colon |
| Elena del Socorro Benítez | 30234567 | +5493768567890 | F | Celíacos |
| Alberto Daniel Ojeda | 21890123 | +5493768678901 | M | Diabetes |
| Zulma Graciela Franco | 29234567 | +5493768789012 | F | Osteoporosis, Mujer Sana |
| Ricardo Ariel Da Silva | 24678901 | +5493768890123 | M | PREDHICAR |
| Nilda Beatriz Cabral | 27234567 | +5493768901234 | F | Plan Materno Infantil |
| Gustavo Adolfo Dos Santos | 23678901 | +5493769012345 | M | Hombre Sano, Diabetes |

Todos los pacientes: consent=true, registeredVia=IMPORT, whatsappLinked=true
