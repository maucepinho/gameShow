# Como salvar e recuperar versões

Execute os comandos no terminal, dentro da pasta do projeto (`meu-jogo-quiz`).

Os arquivos de áudio e imagem em `src/assets/audio/` e `src/assets/images/` são ignorados pelo Git; apenas a estrutura das pastas é versionada. Novos commits não salvam nem recuperam essas mídias. Mantenha um backup separado delas.

## Salvar uma versão

Antes de começar uma nova alteração, confira se a versão atual está salva:

```bash
git status
```

Depois de concluir e conferir uma alteração, salve um commit com uma descrição clara e envie ao GitHub:

```bash
git add .
git commit -m "Descreve a alteração realizada"
git push
```

O commit guarda a versão neste computador. O push envia os commits ao GitHub. Eles não acontecem automaticamente. Confira os arquivos com `git status` antes de salvar; senhas e arquivos `.env` devem permanecer fora do repositório.

## Consultar versões salvas

```bash
git log --oneline --decorate
git tag
```

A marca **`v0.1.0`** identifica a primeira versão salva, em 27/10/2026.

A marca **`pre-buzzer`** preserva a versão estável imediatamente anterior ao buzzer integrado. A versão **`v0.2.0`** adiciona o buzzer multiplayer. Para desfazer essa alteração grande, você pode pedir para recuperar `pre-buzzer`; suas mídias locais continuam fora do Git.

A versão **`v0.2.1`** prioriza o uso dos celulares na mesma rede Wi-Fi do notebook, com descoberta do endereço local para os links e QR codes.

O histórico publicado foi limpo para excluir as mídias de todas as versões, mantendo o código e a tag `v0.1.0`. Essa limpeza alterou os identificadores dos commits. Se você possui uma cópia anterior à limpeza em outro computador, faça um novo clone e copie suas mídias locais separadamente antes de continuar o trabalho.

## Recuperar a versão inicial

Salve primeiro qualquer trabalho em andamento com um commit e mantenha uma cópia de segurança das pastas de mídia fora do projeto, pois esses arquivos não são protegidos pelos commits. Em seguida, crie uma linha de trabalho a partir da versão inicial:

```bash
git switch -c recuperar-versao-inicial v0.1.0
npm ci
npm start
```

Isso abre a versão inicial em uma nova branch. O histórico das alterações posteriores continua guardado na branch `main`. Para voltar a ela, salve suas alterações e execute:

```bash
git switch main
npm ci
```

A versão `v0.1.0` ainda tem o `.gitignore` original, anterior à exclusão das mídias. Antes de criar novos commits em uma branch baseada nela, copie as regras atuais de exclusão de mídias do `.gitignore` da branch `main`. Sem essas regras, `git add .` poderia adicionar os arquivos de mídia novamente.

Para recuperar outra versão, use o identificador exibido por `git log` no lugar de `v0.1.0` e escolha um novo nome para a branch.

## Desfazer uma alteração publicada

Para desfazer um commit da branch atual preservando o histórico, use o identificador do commit que deseja desfazer:

```bash
git revert IDENTIFICADOR_DO_COMMIT
git push
```

O Git cria um novo commit que desfaz aquela alteração. Se houver conflitos, resolva-os antes de continuar. Você também pode pedir ajuda informando qual versão quer recuperar.

## Rotina para próximas alterações

1. Salvar o estado atual antes de iniciar uma mudança.
2. Fazer e conferir uma mudança por vez.
3. Criar um commit com uma descrição do resultado.
4. Enviar os commits ao GitHub com `git push`.

Assim, cada mudança salva pode ser consultada ou desfeita depois.
