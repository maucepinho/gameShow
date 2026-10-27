# Servidor de buzzer do GameShow

Serviço Node.js independente. O apresentador pode continuar com o jogo no computador e conectar-se à URL HTTPS deste serviço; participantes entram por código ou QR de qualquer rede. Este servidor publica somente a interface leve de participantes em `public/`, sem os áudios e imagens do jogo.

Requer Node.js 22 ou superior. Dentro desta pasta:

```powershell
npm ci
npm start
```

O serviço local fica em `http://localhost:3001`. `npm test` executa testes com conexões reais de Socket.IO e HTTP.

## Configuração

Para testar localmente, copie `.env.example` para `.env`, que é ignorado pelo Git. `npm start` carrega esse arquivo. Na hospedagem, configure as variáveis no painel do serviço:

| Variável | Uso |
| --- | --- |
| `PORT` | Porta do serviço; padrão `3001`. A hospedagem normalmente fornece esta variável. |
| `PUBLIC_URL` | URL pública HTTPS do buzzer, por exemplo `https://seu-buzzer.onrender.com`. Usada para os links dos QR codes. |
| `RENDER_EXTERNAL_URL` | Alternativa automática a `PUBLIC_URL` no Render. |
| `ALLOWED_ORIGINS` | Origens adicionais do apresentador, separadas por vírgula. Por exemplo `https://meu-jogo.exemplo.com`. |

`http://localhost:3000` e `http://127.0.0.1:3000` são sempre permitidos para conectar o jogo local ao serviço público. A interface de participantes usa a origem do próprio serviço. Para acesso de outra máquina na rede local, acrescente a origem exata do jogo (com protocolo e porta) em `ALLOWED_ORIGINS`. Um QR gerado em `localhost` não será acessível pelo celular; para jogar pela internet, use o serviço publicado e HTTPS.

## Publicação

Crie um serviço web Node.js apontando para a pasta `buzzer-server`, com comando de instalação `npm ci --omit=dev` e inicialização `npm start`. Use uma única instância e desative escala horizontal. O endpoint `/health` serve como verificação de disponibilidade. HTTPS deve ser fornecido pela hospedagem. Os dados de autenticação são tokens aleatórios; o servidor nunca os inclui nos snapshots, QR codes nem nos logs.

**As salas ficam somente na memória.** Reiniciar, atualizar, suspender ou encerrar o processo perde salas, sessões e placares do buzzer. O jogo e suas mídias locais continuam no computador. Planos gratuitos podem suspender serviços ociosos e causar essa perda: para um evento, acorde o serviço antes de criar a sala e utilize uma hospedagem que permaneça ativa durante a partida. Não é necessário banco de dados para essa primeira versão, e não há promessa de recuperar uma sala após um reinício.

Salas expiram após 24 horas sem operações, com limite absoluto de 7 dias. Há limites de 200 salas por processo, 100 jogadores e 20 equipes por sala; a identidade de quem desconecta continua ocupando sua vaga até ser removida pelo apresentador. Cada sala admite até 5.000 operações distintas de abrir/reiniciar rodada. Esses limites e a frequência de solicitações são aplicados no servidor. Mudá-los exige revisar a capacidade da hospedagem.

## Regras de sincronização

O servidor decide a ordem de chegada e os pontos. O tempo de reação usa relógio monotônico; diferenças de latência entre redes ainda podem influenciar quem chega primeiro. Cada participante só registra um toque por rodada. A fila pode continuar recebendo toques depois do primeiro; o apresentador julga um por vez. Um erro avança para a próxima pessoa e um acerto encerra a rodada. O prazo e o botão de fechar impedem novos toques, mas permitem julgar a fila já registrada. Desconectar o último dispositivo do apresentador fecha os botões; reconectar exige iniciar/rearmar a rodada.

Os tokens de sessão identificam apresentador e jogador e devem ser tratados como credenciais. `room:create.requestId` também funciona como credencial transitória para repetir a criação se a confirmação se perder; o cliente deve gerar um UUID aleatório, manter esse ID somente durante a tentativa e nunca publicá-lo. Os eventos e tipos estão em [PROTOCOL.md](PROTOCOL.md).
