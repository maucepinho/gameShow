# GameShow

Quiz de músicas com as categorias **Filmes**, **Desenhos**, **Novelas** e **Seriados**. Escolha a categoria na tela inicial e, em seguida, um número para ouvir o áudio e revelar a imagem.

Os áudios e imagens de `src/assets/audio/` e `src/assets/images/` são mantidos apenas localmente e ignorados pelo Git. O repositório mantém a estrutura das pastas com arquivos `.gitkeep`. Ao clonar o projeto, adicione suas mídias separadamente; as categorias ficam vazias até receberem perguntas.

## Buzzer dos jogadores

O buzzer integrado oferece celulares por link/código/QR, ordem de chegada, equipes, placar, sons e personalização. Abrir cada número inicia uma rodada automaticamente. O apresentador pode pausar a música no primeiro toque, julgar respostas e rearmar sem trocar de site.

Consulte [BUZZER.md](BUZZER.md) para iniciar tudo com `npm run dev` e publicar o serviço para jogadores de outras redes. O servidor publica somente a página dos participantes; suas mídias continuam locais.

## Executar

```bash
npm install
npm start
```

Abra http://localhost:3000. Para gerar a versão de produção, execute `npm run build`. Para executar os testes uma vez, use `npm test -- --watchAll=false`.

## Adicionar perguntas

Coloque o áudio e a imagem nas subpastas da categoria, usando o mesmo número ao final do nome:

| Categoria | Pasta dos áudios | Pasta das imagens |
| --- | --- | --- |
| Filmes | `src/assets/audio/filmes/` | `src/assets/images/filmes/` |
| Desenhos | `src/assets/audio/desenhos/` | `src/assets/images/desenhos/` |
| Novelas | `src/assets/audio/novelas/` | `src/assets/images/novelas/` |
| Seriados | `src/assets/audio/seriados/` | `src/assets/images/seriados/` |

Por exemplo, estes dois arquivos criam a pergunta **1** de **Desenhos**, sem editar o código:

```text
src/assets/audio/desenhos/nome_1.mp3
src/assets/images/desenhos/nome_1.jpg
```

- Áudio: `.mp3`. Imagem: `.png`, `.jpg`, `.jpeg` ou `.webp`.
- Use o padrão `nome_NUMERO.extensao`, com um número inteiro positivo após o último `_`. Exemplo: `filme_1917_36.mp3` usa o ID **36**, não 1917.
- Cada ID deve ser único dentro da categoria. Categorias diferentes podem ter uma pergunta **1** cada. Os números aparecem em ordem crescente, e não precisam ser consecutivos.
- Se sua cópia local contém os 35 filmes originais, os IDs **1 a 35** já estão ocupados. Nesse caso, adicione novos filmes com IDs livres a partir de **36**, nas mesmas subpastas.
- Coloque os arquivos diretamente na pasta da categoria, sem subpastas adicionais. Use os nomes de pasta em minúsculas exatamente como na tabela.
- Sempre adicione o par áudio + imagem. Um áudio sem imagem ainda aparece no jogo, mas não terá uma imagem para revelar. Uma imagem sem áudio não cria uma pergunta.
- IDs ausentes, zero, negativos, decimais ou maiores que o limite seguro de inteiros do JavaScript são ignorados. Evite duplicatas para manter o par correto.

O carregamento acontece ao iniciar/compilar o projeto. Depois de adicionar arquivos, atualize a página; se o servidor de desenvolvimento não detectar a nova mídia, reinicie `npm start`. Para uma versão publicada, gere e publique um novo `build`.

Os nomes, ícones e títulos das categorias ficam em `src/data/categories.ts`; o carregamento das mídias fica em `src/data/questions.ts` e `src/data/questionLoader.ts`.

## Histórico e recuperação de versões

O estado inicial do projeto foi marcado como **`v0.1.0`**. O Git guarda as versões salvas em commits; editar arquivos por si só não cria uma versão. Consulte [VERSOES.md](VERSOES.md) para salvar alterações, enviar ao GitHub e recuperar uma versão anterior.
