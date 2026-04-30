# 🐾 Animal Sweet - WhatsApp Bot

Asistente virtual inteligente para la **Clínica Veterinaria Animal Sweet**. Este bot utiliza inteligencia artificial (Gemini y DeepSeek) para ofrecer una atención al cliente de alta calidad, gestionar citas y ventas.

## 👩‍💼 marIA: Tu Recepcionista Virtual

El bot cuenta con la personalidad de **marIA**, una recepcionista profesional y empática que:
- **Gestiona Citas**: Integra un enlace obligatorio de Odoo para el agendamiento: `https://animalsweetonline.odoo.com/appointment`.
- **Triage de Emergencias**: Identifica síntomas críticos y prioriza la atención inmediata.
- **Memoria Conversacional**: Recuerda datos de la mascota y el hilo de la conversación para una atención coherente.
- **IA Híbrida**: Utiliza Google Gemini 1.5 Flash por defecto, con un respaldo automático en DeepSeek V3 si el primero falla.

## 🚀 Características

- **Menús Interactivos**: Navegación fluida mediante encuestas de WhatsApp.
- **Fallback Inteligente**: Responde preguntas generales fuera de los menús predefinidos.
- **Redundancia Total**: Sistema de cambio automático de cerebro IA ante fallos de tokens o cuotas.
- **Administración**: Registro de pedidos en un archivo JSON local y notificaciones al administrador.

## 🛠️ Instalación y Uso

1. Clonar el repositorio.
2. Instalar dependencias: `npm install`.
3. Configurar el archivo `.env` con tus API Keys (Gemini y DeepSeek).
4. Iniciar el bot: `node index.js` (o usa el alias `botanimal`).

---
Desarrollado para la Clínica Veterinaria Animal Sweet.
