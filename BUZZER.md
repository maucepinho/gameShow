# Buzzer integrado

O modo padrão agora é pela **mesma rede Wi-Fi do notebook**, sem hospedagem. O notebook executa o jogo e o servidor do buzzer; os jogadores acessam uma página leve no celular por link, código de seis caracteres ou QR code. Os áudios e imagens continuam locais.

## Iniciar no computador

Requer Node.js 22 ou superior. Na primeira instalação do projeto, execute:

```bash
npm run setup
```

Para iniciar o jogo e o servidor local juntos:

```bash
npm run dev
```

## Jogar pelo Wi-Fi do notebook

1. Conecte o notebook e todos os celulares à mesma rede Wi-Fi.
2. Inicie tudo com `npm run dev` e abra o jogo em `http://localhost:3000` no notebook.
3. Em **Buzzer dos jogadores**, use **Usar servidor deste notebook** e crie a sala. O endereço do servidor no notebook pode ficar como `http://localhost:3001`.
4. Abra **Convidar jogadores · link e QR code**. O jogo detecta o endereço de rede do notebook e usa esse endereço no link e no QR. **Não envie localhost aos celulares.**
5. Nos celulares, leia o QR ou abra o link e escolha um nome. Também é possível abrir o endereço mostrado no terminal em **Celulares na mesma rede (Wi-Fi)** e digitar o código da sala.

Se houver várias conexões, escolha **Wi-Fi** em **Endereço para os celulares**. A troca atualiza o link e o QR juntos. O IP é detectado a cada criação de sala, sem ficar gravado no código; ele pode mudar ao trocar de rede.

Mantenha o notebook ligado, sem suspensão, e o terminal aberto durante a partida. O roteador precisa permitir comunicação entre os aparelhos: redes de convidados ou com isolamento entre clientes podem impedir o acesso. Se o celular não abrir o link, confira se ambos estão no mesmo Wi-Fi e se o firewall permite o Node.js na rede privada. Não é necessário abrir portas do roteador nem contratar hospedagem para este modo.

Também é possível iniciar somente o jogo com `npm start`, ou somente o servidor local com `npm run start:buzzer`. Se você usar o servidor publicado, não precisa manter outro servidor local aberto: basta `npm start` para o jogo.

## Opcional: publicar o servidor para jogar pela internet

[Publicar o buzzer no Render](https://render.com/deploy?repo=https://github.com/maucepinho/gameShow)

O arquivo `render.yaml` já configura um serviço Node.js que publica somente a pasta `buzzer-server`. Não publique o build do quiz para disponibilizar o buzzer.

1. Abra o link acima, entre ou crie sua conta no Render e confira o serviço proposto. O serviço ainda não é publicado apenas por este projeto estar no GitHub.
2. Confirme o plano **Free** e crie o serviço. A publicação precisa ser concluída na sua própria conta; não é necessário fornecer senhas ao projeto.
3. Quando o serviço estiver disponível, copie sua URL HTTPS, como `https://gameshow-buzzer-xyz.onrender.com`.
4. No GameShow local, abra **Buzzer dos jogadores**, cole essa URL em **Endereço do servidor do buzzer** e crie a sala.
5. Compartilhe o link ou QR code da sala. Cada jogador escolhe um nome e entra pelo celular. O código também funciona na página inicial desse mesmo servidor.

O endereço informado fica salvo neste navegador. Como alternativa, defina `REACT_APP_BUZZER_URL` no arquivo `.env.local` do jogo, seguindo `.env.example`, e reinicie `npm start`. Essa variável contém uma URL pública, nunca uma senha.

O plano gratuito pode suspender o serviço após inatividade e levar cerca de um minuto para voltar. **Salas e placares ficam na memória: reiniciar, suspender ou atualizar o servidor apaga a partida.** Antes de jogar, abra a URL e aguarde o serviço ficar disponível; depois crie a sala. O plano gratuito serve para experimentar. Para um evento que exige disponibilidade contínua, use uma hospedagem que permaneça ativa. Consulte as [limitações atuais do Render](https://render.com/docs/free).

As atualizações automáticas da hospedagem estão desativadas no `render.yaml`, para evitar reiniciar uma partida por causa de um novo commit. Atualize o serviço manualmente pelo painel quando não houver jogo em andamento. Use uma única instância do servidor.

## Durante a partida

- **Abrir um número:** inicia uma rodada nova e libera os botões dos celulares automaticamente. O rótulo enviado informa somente a categoria e o número, sem revelar a resposta.
- **Primeiro toque:** aparece no jogo com nome, posição e tempo. Por padrão, pausa a música. A opção pode ser desligada em **Regras e preferências**.
- **Outros toques:** entram na fila em ordem de chegada. Cada jogador toca uma vez por rodada.
- **Acertou:** aplica os pontos por acerto e fecha os botões.
- **Errou:** aplica os pontos por erro e chama a próxima pessoa da fila. Os pontos por erro podem ser zero ou negativos.
- **Rearmar botões:** limpa a fila da pergunta atual e abre uma nova tentativa; preserva o placar.
- **Fechar a pergunta:** fecha os botões. Abrir a próxima pergunta começa outra rodada, sem usar o site do HamBuzzer.
- **Cronômetro:** opcional, de 1 a 600 segundos; zero desliga o limite. Ao terminar, bloqueia novos toques, mas você ainda pode julgar a fila registrada. As novas regras de tempo passam a valer ao abrir ou rearmar uma rodada.

A seção **Placar e jogadores** permite dar ou tirar pontos, usar valores personalizados, atribuir equipes, bloquear botões ou remover participantes. O placar das equipes soma os pontos dos integrantes; ao trocar alguém de equipe, seus pontos passam a contar para a nova equipe.

Cada jogador pode personalizar nome, avatar, cor e som no próprio celular. Os sons são sintetizados pelo navegador, sem arquivos de áudio extras. O navegador pode exigir um toque para liberar som; use o controle de som para ativar ou silenciar. A ordem é definida pela chegada ao servidor, e a latência das redes pode influenciar o resultado.

## Conexão e recuperação

Mantenha a aba do apresentador aberta. Se ela perder a conexão, os botões são fechados assim que o servidor detecta a desconexão. Ao reconectar na mesma pergunta, a fila e o resultado são preservados; use **Rearmar botões** para iniciar outra tentativa. Se você abriu outra pergunta enquanto estava sem conexão, essa nova pergunta será sincronizada quando a conexão voltar. Cliques de rodadas antigas não são aceitos na rodada nova.

Recarregar a página no mesmo navegador recupera a identidade e os pontos, enquanto a sala existir e o armazenamento do navegador estiver disponível. O acesso do apresentador fica salvo somente neste navegador. **Sair da sala e esquecer acesso** apaga essa credencial local. A saída não deve ser usada apenas para minimizar a seção do buzzer: recolha a seção pelo título.

Depois de reiniciar o servidor ou expirar a sala, crie uma nova partida. As salas expiram após 24 horas sem operações. Esta versão não guarda histórico permanente de partidas em um banco de dados. Isso não altera o histórico Git do código.

## Verificação técnica

```bash
npm test -- --watchAll=false --runInBand
npm run test:buzzer
npm run build
```

O servidor tem testes com conexões reais para concorrência, autorização, cliques repetidos, rodadas antigas, reconexão, equipes e prazo. O frontend testa o fluxo de abrir/fechar perguntas, pausa da música e controles do apresentador. As configurações do serviço e o protocolo estão em [buzzer-server/README.md](buzzer-server/README.md) e [buzzer-server/PROTOCOL.md](buzzer-server/PROTOCOL.md).
