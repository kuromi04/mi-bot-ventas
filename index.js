require('dotenv').config();

// --- Validación de Entorno ---
const REQUIRED_ENV = ['GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'ADMIN_JID'];
const missingEnv = REQUIRED_ENV.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
    console.error(`\x1b[31m[ERROR CRÍTICO] Faltan variables de entorno: ${missingEnv.join(', ')}\x1b[0m`);
    console.error(`Por favor, configúralas en tu archivo .env antes de iniciar.`);
    process.exit(1);
}

// --- Importaciones de Módulos ---
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    downloadMediaMessage
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs').promises;
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- Configuración de DeepSeek API ---
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/chat/completions";

/**
 * Llama a la API de DeepSeek usando fetch con timeout.
 */
async function callDeepSeek(messages, model = "deepseek-chat") {
    if (!DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY no configurada.");
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

    try {
        const response = await fetch(DEEPSEEK_BASE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                temperature: 0.7
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeout);
        
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(`HTTP ${response.status}: ${errData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        clearTimeout(timeout);
        if (error.name === 'AbortError') {
            console.error("[ERROR] DeepSeek API: Tiempo de espera agotado (15s)");
            return "Lo siento, la respuesta de la IA está tardando demasiado. Por favor, intenta de nuevo.";
        }
        console.error("[ERROR] DeepSeek API:", error.message);
        return "Lo siento, tuve un problema al conectar con el servicio de IA.";
    }
}

// --- Constantes y Configuración ---
const RUTA_SESION = 'sesion_bot_ventas';
const RUTA_PEDIDOS = './pedidos.json';
const NOMBRE_NEGOCIO = "Animal Sweet";
const ADMIN_JID = process.env.ADMIN_JID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BOT_REPLY_FOOTER = `\n\n---\nEscribe *"menú"* para volver al inicio o *"agente"* para hablar con una persona.`;
const WHATSAPP_CATALOG_LINK = "https://wa.me/c/573234341908";
const APPOINTMENT_LINK = "https://animalsweetonline.odoo.com/appointment";

// --- Prompts de Persona ---

const CLINIC_SYSTEM_PROMPT = `Eres marIA, la Recepcionista Experta de Animal Sweet.
Tu tono es cálido, profesional y clínico.
REGLA DE ORO: No te presentes en cada mensaje. Solo di quién eres al inicio de la conversación.
CONTEXTO: Mantén la coherencia con lo que el usuario te ha dicho antes (edad de la mascota, síntomas, nombre).
CITAS: Si el usuario desea agendar, envía SIEMPRE: ${APPOINTMENT_LINK}
EMERGENCIAS: Ante síntomas graves, prioriza la atención inmediata.
Firmado: marIA de Animal Sweet.`;

const SALES_SYSTEM_PROMPT = `Eres marIA de Animal Sweet. Gestionas ventas y citas.
No te presentes repetidamente. Mantén el hilo de la conversación.
REGLA DE ORO: Para agendar cualquier servicio, envía SIEMPRE: ${APPOINTMENT_LINK}
Recuerda los datos previos del usuario (producto interesado, mascota).`;

// --- Inicialización de Gemini ---
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const chatModel = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    systemInstruction: CLINIC_SYSTEM_PROMPT
});
const salesModel = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    systemInstruction: SALES_SYSTEM_PROMPT
});

// --- Variable de Estado Global ---
let botActivado = true;
const userState = new Map();
const processedPollVotes = new Set(); // Evita bucles infinitos en encuestas

// --- Funciones de Lógica de Negocio ---

async function leerPedidos() {
    try {
        await fs.access(RUTA_PEDIDOS);
        const data = await fs.readFile(RUTA_PEDIDOS, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

async function guardarPedido(sock, from, pedidoData) {
    const pedidos = await leerPedidos();
    const proximoId = Math.floor(100000 + Math.random() * 900000);
    const nuevoPedido = {
        id: `PED-${proximoId}`,
        cliente: from.split('@')[0],
        ...pedidoData,
        fecha: new Date().toLocaleString('es-CO'),
        estado: 'pendiente'
    };
    pedidos.push(nuevoPedido);
    try {
        await fs.writeFile(RUTA_PEDIDOS, JSON.stringify(pedidos, null, 2), 'utf-8');
        await sock.sendMessage(ADMIN_JID, { text: `🔔 *NUEVO PEDIDO RECIBIDO* 🔔\n\n*ID:* ${nuevoPedido.id}\n*Cliente:* ${nuevoPedido.cliente}\n*Producto:* ${nuevoPedido.producto}\n*Cantidad:* ${nuevoPedido.cantidad}` });
        return nuevoPedido.id;
    } catch (error) {
        console.error(`[ERROR] Guardar pedido:`, error);
        return null;
    }
}

// --- Funciones de Interacción (Mensajes) ---

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function sendPollMessage(sock, from, name, options) {
    const instructionalName = `${name}\n\n👇 *Haga clic en una opción abajo:*`;
    await sock.sendMessage(from, {
        poll: {
            name: instructionalName,
            values: options,
            selectableCount: 1
        }
    });
}

async function handleGeneralAIQuery(sock, from, text) {
    try {
        await sock.sendPresenceUpdate('composing', from);
        const result = await chatModel.generateContent(text);
        const responseText = result.response.text();
        await sendBotMessage(sock, from, { text: responseText }, true);
    } catch (e) {
        console.error("[FALLBACK] Gemini falló, intentando DeepSeek:", e.message);
        try {
            const responseText = await callDeepSeek([
                { role: 'system', content: CLINIC_SYSTEM_PROMPT },
                { role: 'user', content: text }
            ]);
            await sendBotMessage(sock, from, { text: responseText }, true);
        } catch (deepError) {
            console.error("[ERROR CRÍTICO] Ambos modelos fallaron:", deepError.message);
            await sendBotMessage(sock, from, { text: "Lo siento, tengo un problema técnico momentáneo. Por favor, intenta más tarde o escribe 'agente' para hablar con un colega." });
        }
    }
}

async function sendBotMessage(sock, from, message, withFooter = false) {
    if (message.text && withFooter) {
        message.text += BOT_REPLY_FOOTER;
    }
    await sock.sendMessage(from, message);
}

// --- Menús y Navegación ---

async function enviarMensajeBienvenidaConOpciones(sock, from) {
    userState.set(from, { menu: 'inicio' });
    const textoOpciones = `🐾 ¡Hola! Bienvenido a la *${NOMBRE_NEGOCIO}*.\n\nSoy tu asistente clínico. ¿Cómo podemos ayudarte hoy?\n\n1. 🏥 Servicios y Citas\n2. 🚨 Urgencias\n3. 🤖 Consulta Médica (IA)`;
    await sendPollMessage(sock, from, textoOpciones, ['1. Servicios y Citas', '2. Urgencias', '3. Consulta Médica (IA)']);
}

async function enviarMenuPrincipal(sock, from) {
    userState.set(from, { menu: 'main' });
    const textoMenu = `*MENÚ PRINCIPAL* 🏠\nElige una opción:\n\n1. 🛍️ Tienda y Alimentos\n2. 📅 Agendar Cita\n3. 🩺 Servicios Clínicos\n4. 🤖 Hablar con IA Médica\n5. 📍 Ubicación y Horarios`;
    const options = ['1. Tienda y Alimentos', '2. Agendar Cita', '3. Servicios Clínicos', '4. Hablar con IA Médica', '5. Ubicación y Horarios'];
    await sendPollMessage(sock, from, textoMenu, options);
}

async function enviarMenuServicios(sock, from) {
    userState.set(from, { menu: 'servicios' });
    const texto = `*NUESTROS SERVICIOS* 🩺\nContamos con:\n\n- Consulta General\n- Vacunación\n- Cirugía\n- Laboratorio\n- Grooming (Peluquería)`;
    await sendPollMessage(sock, from, texto, ['Vacunación', 'Grooming', 'Consulta General', '⬅️ Volver al Menú']);
}

async function enviarMenuUrgencias(sock, from) {
    userState.set(from, { menu: 'urgencias' });
    const texto = `*🚨 ATENCIÓN DE URGENCIAS* 🚨\n\nSi tu mascota está en peligro crítico, llámanos de inmediato:\n📞 *+57 300 000 0000*\n\n📍 *Dirección:* Calle Falsa 123, Ciudad.\n\nEstamos listos para atenderte.`;
    await sendBotMessage(sock, from, { text: texto }, true);
}

async function enviarMenuCompras(sock, from) {
    userState.set(from, { menu: 'compras' });
    await sendPollMessage(sock, from, `*TIENDA ANIMAL SWEET* 🛍️`, ['Ver Catálogo', 'Hacer un Pedido', 'Gestionar mis Pedidos', '⬅️ Volver al Menú']);
}

async function iniciarConversacionGemini(sock, from) {
    const chat = chatModel.startChat({ history: [] });
    userState.set(from, { menu: 'chateando_con_ia', chat: chat, ai_model: 'gemini' });
    await sendBotMessage(sock, from, { text: '🐾 Hola, soy marIA. ¿En qué puedo ayudarte con tu mascota hoy?\n\n_Escribe "salir" para volver._' });
}

async function iniciarProcesoPedidoIA(sock, from) {
    const chat = salesModel.startChat({ history: [] });
    userState.set(from, { menu: 'proceso_pedido_ia', chat: chat, ai_model: 'gemini' });
    await sendBotMessage(sock, from, { text: '🛍️ ¡Hola! Soy marIA. ¿Qué producto o servicio te gustaría adquirir?\n\n_Escribe "salir" para cancelar._' });
}

async function enviarMenuGestionPedidos(sock, from) {
    userState.set(from, { menu: 'gestion_pedidos' });
    await sendPollMessage(sock, from, `*GESTIÓN DE PEDIDOS* 📦`, ['Ver mis pedidos', 'Estado por ID', 'Cancelar pedido', '⬅️ Volver']);
}

// --- Manejadores de Lógica ---

async function handleMenuNavigation(sock, from, textoLower, currentState) {
    const menuActual = currentState.menu;
    // Normalización: Quitar tildes y dejar solo letras/números/espacios
    const opcion = textoLower.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

    if (opcion.includes('volver') || opcion === '0') {
        if (menuActual === 'main' || menuActual === 'inicio') return await enviarMensajeBienvenidaConOpciones(sock, from);
        if (menuActual === 'gestion_pedidos') return await enviarMenuCompras(sock, from);
        await enviarMenuPrincipal(sock, from);
        return true;
    }

    switch (menuActual) {
        case 'inicio':
            if (opcion.includes('servicios') || opcion.includes('citas') || opcion.includes('1')) {
                await enviarMenuPrincipal(sock, from);
                return true;
            } else if (opcion.includes('urgencia') || opcion.includes('2')) {
                await enviarMenuUrgencias(sock, from);
                return true;
            } else if (opcion.includes('ia') || opcion.includes('medica') || opcion.includes('3')) {
                await iniciarConversacionGemini(sock, from);
                return true;
            }
            break;
            
        case 'main':
            if (opcion.includes('tienda') || opcion.includes('alimento') || opcion === '1') {
                await enviarMenuCompras(sock, from);
                return true;
            } else if (opcion.includes('cita') || opcion.includes('agendar') || opcion === '2') {
                await sendBotMessage(sock, from, { text: `📅 Para agendar tu cita en *Animal Sweet*, por favor ingresa aquí:\n${APPOINTMENT_LINK}\n\nAllí podrás elegir el servicio y el horario que mejor te convenga.` }, true);
                return true;
            } else if (opcion.includes('servicio') || opcion.includes('clinico') || opcion === '3') {
                await enviarMenuServicios(sock, from);
                return true;
            } else if (opcion.includes('ia') || opcion.includes('medica') || opcion === '4') {
                await iniciarConversacionGemini(sock, from);
                return true;
            } else if (opcion.includes('ubicacion') || opcion.includes('horario') || opcion === '5') {
                await sendBotMessage(sock, from, { text: "📍 Ubicación: Calle Falsa 123.\n🕒 Horario: Lunes a Sábado 8am - 6pm." }, true);
                return true;
            }
            break;

        case 'compras':
            if (opcion.includes('catalogo')) {
                await sendBotMessage(sock, from, { text: `Mira nuestro catálogo aquí: ${WHATSAPP_CATALOG_LINK}` }, true);
                return true;
            } else if (opcion.includes('hacer') || opcion.includes('pedido')) {
                await iniciarProcesoPedidoIA(sock, from);
                return true;
            } else if (opcion.includes('gestionar')) {
                await enviarMenuGestionPedidos(sock, from);
                return true;
            }
            break;

        case 'gestion_pedidos':
            if (opcion.includes('ver')) {
                await sendBotMessage(sock, from, { text: "Esta función estará disponible pronto. Por ahora, contacta a un agente." }, true);
                return true;
            } else if (opcion.includes('estado')) {
                await sendBotMessage(sock, from, { text: "Por favor, indícanos tu ID de pedido para consultar." }, true);
                return true;
            } else if (opcion.includes('cancelar')) {
                await sendBotMessage(sock, from, { text: "Para cancelar, por favor escribe 'agente' para que un humano te asista." }, true);
                return true;
            }
            break;

        case 'servicios':
            if (opcion.includes('vacuna') || opcion.includes('grooming') || opcion.includes('peluqueria') || opcion.includes('consulta')) {
                await sendBotMessage(sock, from, { text: `🐾 Para este servicio, puedes agendar directamente en nuestro sistema:\n${APPOINTMENT_LINK}\n\n¡Esperamos ver a tu mascota pronto!` }, true);
                return true;
            }
            break;
    }
    
    // Si no se reconoció la opción del menú, marIA usará la IA para responder en lugar de repetir el error
    return false;
}

async function handleActiveFlows(sock, from, textoLower, currentState) {
    if (currentState.menu === 'chateando_con_ia' || currentState.menu === 'proceso_pedido_ia') {
        if (['salir', 'cancelar', 'menú'].includes(textoLower)) {
            userState.delete(from);
            await enviarMenuPrincipal(sock, from);
            return true;
        }
        try {
            await sock.sendPresenceUpdate('composing', from);
            let responseText = '';
            const modelAI = currentState.ai_model || 'gemini';

            if (modelAI.startsWith('deepseek')) {
                const systemPrompt = currentState.menu === 'proceso_pedido_ia' ? 
                    SALES_SYSTEM_PROMPT : 
                    CLINIC_SYSTEM_PROMPT;
                
                responseText = await callDeepSeek([
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: textoLower }
                ], modelAI);
            } else {
                try {
                    // Re-inicializar el chat de Gemini si se perdió, manteniendo el historial si existe
                    if (!currentState.chat) {
                        const model = currentState.menu === 'proceso_pedido_ia' ? salesModel : chatModel;
                        currentState.chat = model.startChat({ history: currentState.history || [] });
                    }
                    const result = await currentState.chat.sendMessage(textoLower);
                    responseText = result.response.text();

                    // Actualizamos el historial en el estado del usuario para persistencia
                    const history = await currentState.chat.getHistory();
                    userState.set(from, { ...currentState, history: history });

                } catch (geminiError) {
                    console.error("[FALLBACK FLOW] Gemini falló, intentando DeepSeek:", geminiError.message);
                    const systemPrompt = currentState.menu === 'proceso_pedido_ia' ? SALES_SYSTEM_PROMPT : CLINIC_SYSTEM_PROMPT;
                    try {
                        responseText = await callDeepSeek([
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: textoLower }
                        ]);
                    } catch (deepError) {
                        console.error("[ERROR FLUJO AI]:", deepError.message);
                        responseText = "Lo siento, tuve un problema técnico momentáneo. ¿Podrías intentar de nuevo o hablar con un agente?";
                    }
                }
            }

            if (responseText.includes('[PEDIDO_LISTO]')) {
                const jsonStr = responseText.split('[PEDIDO_LISTO]')[1].trim();
                const id = await guardarPedido(sock, from, JSON.parse(jsonStr));
                await sendBotMessage(sock, from, { text: `✅ ¡Pedido registrado con éxito! Tu ID de seguimiento es: *${id}*. Pronto nos contactaremos contigo.` });
                userState.delete(from);
                await delay(2000);
                await enviarMenuPrincipal(sock, from);
            } else {
                await sendBotMessage(sock, from, { text: responseText });
            }
        } catch (e) {
            console.error("[ERROR IA] Detalle:", e);
            await sendBotMessage(sock, from, { text: `Lo siento, tuve un problema técnico (${e.message}). ¿Podrías intentar de nuevo?` });
        }
        return true;
    }
    return false;
}

const intents = {
    greetings: { keywords: ['hola', 'comenzar'], action: enviarMensajeBienvenidaConOpciones },
    menu: { keywords: ['menu', 'menú'], action: enviarMenuPrincipal }
};

async function handleMessage(sock, msg) {
    const from = msg.key.remoteJid;
    const messageType = Object.keys(msg.message)[0];
    let text = "";

    if (messageType === 'conversation') text = msg.message.conversation;
    else if (messageType === 'extendedTextMessage') text = msg.message.extendedTextMessage.text;
    else if (messageType === 'pollUpdateMessage') return; // Manejado por events.update

    const textoLower = text.toLowerCase().trim();
    const currentState = userState.get(from);

    for (const i in intents) {
        if (intents[i].keywords.includes(textoLower)) {
            userState.delete(from);
            return await intents[i].action(sock, from);
        }
    }

    if (currentState && await handleActiveFlows(sock, from, textoLower, currentState)) return;
    if (currentState?.menu && await handleMenuNavigation(sock, from, textoLower, currentState)) return;
    
    // Fallback Global: Si nada procesó el mensaje y es texto largo, usamos la IA para responder
    if (text.length > 2) {
        await handleGeneralAIQuery(sock, from, text);
    } else if (!currentState) {
        await enviarMensajeBienvenidaConOpciones(sock, from);
    }
}

// --- Inicio del Bot ---

async function conectarWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(RUTA_SESION);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        logger: pino({ level: 'silent' }),
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('✅ Nuevo código QR generado. Escanéalo con WhatsApp:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect.error?.output?.statusCode;
            const debeReconectar = statusCode !== DisconnectReason.loggedOut;
            
            console.log(`❌ Conexión cerrada. Código: ${statusCode}. Reconectando: ${debeReconectar}`);
            
            if (debeReconectar) {
                conectarWhatsApp();
            } else {
                console.log('🚪 Sesión cerrada permanentemente. Borra la carpeta de sesión para vincular de nuevo.');
            }
        } else if (connection === 'open') {
            console.log('🚀 Animal Sweet conectado con éxito!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        try {
            await handleMessage(sock, msg);
        } catch (e) { console.error(e); }
    });

    // Soporte para votos en encuestas (Botones)
    sock.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
            if (update.update.pollUpdates) {
                const from = update.key.remoteJid;
                const pollId = update.key.id;
                const pollUpdate = update.update.pollUpdates[0];
                
                // Extraer el voto
                if (!pollUpdate.vote?.selectedOptions) continue;

                const selectedOption = pollUpdate.vote.selectedOptions[0]?.name;
                if (!selectedOption) continue;

                // Evitar procesar el mismo voto varias veces
                const voteHash = `${from}-${pollId}-${selectedOption}`;
                if (processedPollVotes.has(voteHash)) continue;
                processedPollVotes.add(voteHash);

                console.log(`[VOTO RECIBIDO] ${from}: ${selectedOption}`);
                
                // PROCESAMIENTO INMEDIATO: Inyectamos el texto de la opción directamente
                await handleMessage(sock, { 
                    key: update.key, 
                    message: { conversation: selectedOption },
                    pushName: 'Cliente'
                });
            }
        }
    });
}

conectarWhatsApp();
