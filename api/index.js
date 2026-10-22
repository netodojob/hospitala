const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();

app.use(express.json());
app.use(cors());

app.use(express.static(path.join(__dirname, "../frontend")));

const DB_FILE = path.join(__dirname, "../backend/db.json");

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    return {
      usuarios: [],
      pacientes: [],
      triagens: [],
      consultas: []
    };
  }

  return JSON.parse(fs.readFileSync(DB_FILE));
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// USUÁRIOS
app.get("/usuarios", (req, res) => {
  const db = readDB();
  res.json(db.usuarios.map(({ usuario, tipo }) => ({ usuario, tipo })));
});

app.post("/usuarios", (req, res) => {
  const { usuario, senha, tipo } = req.body;

  if (
    typeof usuario !== "string" ||
    !usuario.trim() ||
    typeof senha !== "string" ||
    !senha ||
    typeof tipo !== "string" ||
    !tipo
  ) {
    return res.status(400).json({ erro: "Preencha usuário, senha e setor." });
  }

  const db = readDB();
  const nomeUsuario = usuario.trim();

  if (db.usuarios.some(item => item.usuario.toLowerCase() === nomeUsuario.toLowerCase())) {
    return res.status(409).json({ erro: "Este usuário já está cadastrado." });
  }

  db.usuarios.push({ usuario: nomeUsuario, senha, tipo });
  writeDB(db);

  res.status(201).json({ usuario: nomeUsuario, tipo });
});

app.delete("/usuarios/:usuario", (req, res) => {
  const db = readDB();
  const nomeUsuario = req.params.usuario;
  const indice = db.usuarios.findIndex(item => item.usuario === nomeUsuario);

  if (indice === -1) {
    return res.status(404).json({ erro: "Usuário não encontrado." });
  }

  db.usuarios.splice(indice, 1);
  writeDB(db);

  res.json({ mensagem: "Usuário excluído com sucesso." });
});

// LOGIN
app.post("/login", (req, res) => {
  const db = readDB();

  const user = db.usuarios.find(u =>
    u.usuario === req.body.usuario &&
    u.senha === req.body.senha
  );

  if (!user) {
    return res.status(401).json({
      erro: "Login inválido"
    });
  }

  res.json(user);
});

// ATENDIMENTO
app.get("/atendimento", (req, res) => {
  const db = readDB();
  res.json(db.pacientes.filter(paciente => !paciente.status || paciente.status === "triagem"));
});

app.get("/atendimento/triagem-ativa", (req, res) => {
  const db = readDB();
  const paciente = db.pacientes.find(
    item => String(item.id) === String(db.pacienteTriagemAtivaId)
  );
  res.json({ paciente: paciente || null });
});

app.post("/atendimento/:id/chamar", (req, res) => {
  const db = readDB();
  const paciente = db.pacientes.find(item => String(item.id) === req.params.id);

  if (!paciente) {
    return res.status(404).json({ erro: "Paciente não encontrado." });
  }

  if (paciente.status && paciente.status !== "triagem") {
    return res.status(409).json({ erro: "Paciente não está aguardando na fila." });
  }

  const pacienteEmTriagem = db.pacientes.find(
    item => String(item.id) === String(db.pacienteTriagemAtivaId)
  );
  if (pacienteEmTriagem) {
    return res.status(409).json({
      erro: "Finalize a triagem atual antes de chamar outro paciente.",
      paciente: pacienteEmTriagem.nome
    });
  }

  paciente.status = "em_triagem";
  db.pacienteTriagemAtivaId = paciente.id;
  const numero = (Number(db.ultimoNumeroChamadaTriagem) || 0) + 1;
  const chamada = {
    id: Date.now(),
    numero: `T-${String(numero).padStart(3, "0")}`,
    paciente: paciente.nome || "Paciente",
    localTipo: "TRIAGEM",
    horario: new Date().toISOString()
  };

  db.ultimoNumeroChamadaTriagem = numero;
  db.chamadasAtuaisTV = db.chamadasAtuaisTV || {};
  db.chamadasAtuaisTV.triagem = chamada;
  db.chamadaAtualTV = chamada;
  db.historicoChamadasTV = [chamada, ...(db.historicoChamadasTV || [])].slice(0, 5);
  writeDB(db);
  res.json({ ...paciente, chamada });
});

app.get("/tv/chamada", (req, res) => {
  const db = readDB();
  const chamadasAtuais = db.chamadasAtuaisTV || {};
  if (!chamadasAtuais.triagem && db.chamadaAtualTV?.localTipo === "TRIAGEM") {
    chamadasAtuais.triagem = db.chamadaAtualTV;
  }
  if (!chamadasAtuais.medico && db.chamadaAtualTV?.localTipo === "CONSULTÓRIO MÉDICO") {
    chamadasAtuais.medico = db.chamadaAtualTV;
  }
  res.json({
    chamada: db.chamadaAtualTV || null,
    chamadasAtuais,
    historico: db.historicoChamadasTV || []
  });
});

app.post("/atendimento", (req, res) => {
  const db = readDB();

  const paciente = {
    id: Date.now(),
    nome: req.body.nome,
    cpf: req.body.cpf,
    documento: req.body.documento,
    sexo: req.body.sexo,
    motivo: req.body.motivo,
    nomeMae: req.body.nomeMae,
    estadoCivil: req.body.estadoCivil,
    endereco: req.body.endereco,
    telefone: req.body.telefone,
    email: req.body.email,
    contatoEmergencia: req.body.contatoEmergencia,
    tipo: req.body.tipo,
    status: "triagem",
    createdAt: new Date()
  };

  db.pacientes.push(paciente);
  writeDB(db);

  res.json(paciente);
});

// TRIAGEM
app.post("/triagem", (req, res) => {
  const db = readDB();
  const paciente = db.pacientes.find(
    item => String(item.id) === String(req.body.pacienteId)
  );

  if (!req.body.pacienteId || !paciente) {
    return res.status(400).json({ erro: "Chame um paciente da fila antes de salvar a triagem." });
  }

  if (
    paciente.status !== "em_triagem" ||
    String(db.pacienteTriagemAtivaId) !== String(paciente.id)
  ) {
    return res.status(409).json({ erro: "O paciente precisa ser chamado antes de salvar a triagem." });
  }

  let risco = req.body.risco;

  if (req.body.temperatura >= 39) {
    risco = "vermelho";
  } else if (req.body.temperatura >= 38) {
    risco = "amarelo";
  } else if (!risco) {
    risco = "verde";
  }

  const triagem = {
    id: Date.now(),
    pacienteId: req.body.pacienteId,
    nome: paciente.nome,
    sintoma: req.body.sintoma,
    temperatura: req.body.temperatura,
    pressaoArterial: req.body.pressaoArterial,
    frequenciaCardiaca: req.body.frequenciaCardiaca,
    saturacaoOxigenio: req.body.saturacaoOxigenio,
    duracaoSintomas: req.body.duracaoSintomas,
    nivelDor: req.body.nivelDor,
    alergia: req.body.alergia,
    observacao: req.body.observacao,
    risco,
    status: "aguardando_medico",
    createdAt: new Date()
  };

  db.triagens.push(triagem);

  db.pacienteTriagemAtivaId = null;

  writeDB(db);

  res.json(triagem);
});

// LISTAR TRIAGENS
app.get("/triagens", (req, res) => {
  const db = readDB();
  res.json(db.triagens.filter(triagem =>
    !triagem.status || triagem.status === "aguardando_medico"
  ));
});

app.get("/triagens/consulta-ativa", (req, res) => {
  const db = readDB();
  const triagem = db.triagens.find(
    item => String(item.id) === String(db.triagemMedicaAtivaId)
  );
  res.json({ triagem: triagem || null });
});

app.post("/triagens/:id/chamar", (req, res) => {
  const db = readDB();
  const triagem = db.triagens.find(item => String(item.id) === req.params.id);

  if (!triagem) {
    return res.status(404).json({ erro: "Triagem não encontrada." });
  }

  if (triagem.status && triagem.status !== "aguardando_medico") {
    return res.status(409).json({ erro: "Paciente não está aguardando atendimento médico." });
  }

  const triagemAtiva = db.triagens.find(
    item => String(item.id) === String(db.triagemMedicaAtivaId)
  );
  if (triagemAtiva) {
    return res.status(409).json({
      erro: "Finalize a consulta atual antes de chamar outro paciente.",
      paciente: triagemAtiva.nome
    });
  }

  triagem.status = "em_consulta";
  db.triagemMedicaAtivaId = triagem.id;
  const numero = (Number(db.ultimoNumeroChamadaMedico) || 0) + 1;
  const chamada = {
    id: Date.now(),
    numero: `M-${String(numero).padStart(3, "0")}`,
    paciente: triagem.nome || "Paciente",
    localTipo: "CONSULTÓRIO MÉDICO",
    horario: new Date().toISOString()
  };
  db.ultimoNumeroChamadaMedico = numero;
  db.chamadasAtuaisTV = db.chamadasAtuaisTV || {};
  db.chamadasAtuaisTV.medico = chamada;
  db.chamadaAtualTV = chamada;
  db.historicoChamadasTV = [chamada, ...(db.historicoChamadasTV || [])].slice(0, 5);

  if (triagem.pacienteId) {
    const paciente = db.pacientes.find(item => String(item.id) === String(triagem.pacienteId));
    if (paciente) {
      paciente.status = "em_consulta";
    }
  }
  writeDB(db);
  res.json({ ...triagem, chamada });
});

// IMPLEMENTADO: rota com lista fixa de medicações
app.get("/lista-medicacoes", (req, res) => {
  res.json([
    "Dipirona",
    "Paracetamol",
    "Ibuprofeno",
    "Amoxicilina",
    "Azitromicina",
    "Loratadina",
    "Omeprazol",
    "Buscopan",
    "Dramin",
    "Soro fisiológico"
  ]);
});

// CONSULTA
app.post("/consulta", (req, res) => {
  const db = readDB();
  const triagem = req.body.triagemId
    ? db.triagens.find(item => String(item.id) === String(req.body.triagemId))
    : null;

  if (req.body.triagemId && !triagem) {
    return res.status(404).json({ erro: "Triagem não encontrada." });
  }

  if (triagem && triagem.status !== "em_consulta") {
    return res.status(409).json({ erro: "Chame o paciente antes de salvar a consulta." });
  }
  if (
    triagem &&
    String(db.triagemMedicaAtivaId) !== String(triagem.id)
  ) {
    return res.status(409).json({ erro: "Esta consulta não corresponde ao paciente médico ativo." });
  }

  const consulta = {
    id: Date.now(),
    triagemId: req.body.triagemId || null,
    paciente: req.body.paciente,
    diagnostico: req.body.diagnostico,
    medicacao: req.body.medicacao,
    dose: req.body.dose,
    frequencia: req.body.frequencia,
    duracao: req.body.duracao,
    obs: req.body.obs,
    destino: req.body.destino,
    desfecho: req.body.desfecho || "alta",
    createdAt: new Date()
  };

  db.consultas.push(consulta);

  if (triagem) {
    const statusPorDesfecho = {
      alta: "concluida",
      observacao: "em_observacao",
      encaminhamento: "encaminhado"
    };
    triagem.status = statusPorDesfecho[consulta.desfecho] || "concluida";

    if (triagem.pacienteId) {
      const paciente = db.pacientes.find(item => String(item.id) === String(triagem.pacienteId));
      if (paciente) {
        paciente.status = triagem.status;
      }
    }
    db.triagemMedicaAtivaId = null;
  }

  writeDB(db);

  res.status(201).json(consulta);
});

// MEDICAÇÕES
app.get("/medicacoes", (req, res) => {
  const db = readDB();
  res.json(db.consultas);
});

// START
module.exports = app;