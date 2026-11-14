# Arremate — guia de design para implementação

Este diretório é a especificação visual do sistema de leilão online (hackathon). **Use-o como referência, não copie o código das telas.**

- `tokens.css` — todas as cores, fontes, raios e tamanhos. É a única fonte de verdade de estilo.
- `telas/*.html` — maquetes de cada tela. São HTML com estilos inline e um bloco `<script type="text/x-dc">` de um editor de design: **não rode esses arquivos nem importe o `support.js`**. Leia o markup para extrair layout, textos, espaçamentos e estados, e reimplemente na stack do projeto usando os tokens.
- `{{algo}}` no markup = valor dinâmico; os dados de exemplo e a lógica de estados estão no `renderVals()` do script de cada tela.

## Identidade

- Nome provisório: **Arremate**. Logo: quadrado índigo raio 10 com ícone de martelo (lucide `gavel`) em branco + nome em Space Grotesk 700.
- Fundo da página `--paper`, cards brancos com borda `--line` 1px e raio 16–20.
- Títulos e valores em **Space Grotesk 700**; texto em **Inter**. Todo valor em dinheiro e relógio usa `font-variant-numeric: tabular-nums`.
- Ícones: lucide (stroke 2, sem emoji).
- Regras de cor:
  - `--primary` = ação.
  - `--live` = só o que está ao vivo ou acabando.
  - `--win` = vitória ou liderança.
  - `--warn` = prorrogação ou reconexão.
  - `--danger` = recusa, erro ou cancelar.

## Telas e rotas

| Tela | Arquivo | Rota sugerida | Acesso | Requisitos |
|---|---|---|---|---|
| Entrar / Criar conta | `Login.html` | `/entrar` | público | RF01, RF02 |
| Listagem | `Listagem.html` | `/` | público | RF20, RF21 |
| Detalhe (agendado) | `Detalhe.html` | `/leiloes/:id` | público | RF20, RF14 |
| Sala ao vivo | `Sala.html` | `/leiloes/:id/sala` | login | RF09–RF15, RF24–RF26 |
| Criar leilão | `Criar.html` | `/anunciar` | login | RF05–RF07 |
| Meus leilões | `MeusLeiloes.html` | `/meus-leiloes` | login | RF08, RF23, RF28 |
| Minhas participações | `Participacoes.html` | `/participacoes` | login | RF27 |
| Perfil do comitente | `Perfil.html` | `/comitentes/:id` | público | RF22 |

Referências gerais:

- `Main.html`: sistema visual completo (componentes e estados).
- `Fluxos.html`: máquina de estados e fluxo do lance.
- `Jornadas.html`: caminhos de ponta a ponta.

## Componentes (ver `Main.html`)

- **Botão**: primário, secundário, perigo; estados padrão, hover/foco (outline 3px `--primary-focus`), enviando (spinner + texto "…"), desativado (`--disabled-bg` + `--ink-2`). Altura 44; botão de lance 56–60.
- **Selo de estado do leilão**:
  - Agendado: `--sched-tint`.
  - Em andamento: fundo `--live`, texto branco, bolinha.
  - Vendido: `--win-tint`.
  - Encerrado sem lances: `--muted-bg`.
  - Cancelado: branco com borda tracejada.
- **Selo de situação (RF27)**:
  - Líder: `--win-tint`.
  - Superado: `--live-tint`.
  - Vencedor: `--win` sólido.
  - Não venceu: `--muted-bg`.
- **Cronômetro**:
  - Normal: `--paper`.
  - Menos de 2 min: `--live-tint` com o texto "Lances agora prorrogam".
  - 00:00: "Aguardando servidor".
- **Avisos (toasts/banners)**:
  - Lance aceito: `--win-tint`.
  - Superado: `--live` sólido, `role="alert"`.
  - Recusado: `--danger-tint`, sempre com motivo + lance mínimo atual.
  - Prorrogação: `--warn-tint`.
- **Indicador de conexão**: Conectado (verde) / Reconectando… (âmbar, banner no topo da sala) / Sem conexão (vermelho).
- **Card de leilão**: foto 190px com selo no canto, categoria em caixa alta, nome, preço (atual ou inicial), lances/horário, rodapé com CTA.
- **Identificação de pessoas na sala (RF09)**: primeiro nome + inicial ("Marina T."), avatar com iniciais e cor estável por hash do id; o próprio usuário aparece como "Você".

## Comportamento que o design pressupõe

- **Dinheiro**: sempre em centavos inteiros; formatar com `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.
- **Horários**: o servidor é a fonte; a tela converte para o fuso de quem vê. O relógio é só visual e sincroniza com o servidor.
- **Sala**:
  - O botão "Dar lance · R$ X" mostra o valor digitado.
  - Durante o envio, o botão fica bloqueado ("Enviando lance…") e manda uma chave única por tentativa.
  - Para o líder, aparece "Você é o líder" (desativado); para o comitente, um aviso no lugar do formulário.
  - Espectador ↔ participante muda sem sair da sala.
- **Atalhos de valor**: Mínimo, +1 incremento, +4 incrementos.
- **Tabela de incremento**: a de referência do PDF.
- **Prorrogação**: um lance a menos de 2 min do fim leva o término para 2 min depois do lance, com até 30 min acumulados.
- **Fim do leilão**: o formulário é trocado por um cartão de resultado:
  - "Você venceu!" (verde sólido).
  - "Vendido para X".
  - "Encerrado sem lances".
- **Limites (decisão da equipe, centralizar em config)**:
  - Nome: até 80 caracteres. Descrição: até 2.000.
  - Fotos: 3–8, JPG/PNG/WebP, até 5 MB cada.
  - Início: de 1 min a 30 dias à frente.
  - Duração: de 3 min a 7 dias.
- **Meus leilões**: os botões Editar, Cancelar e Relistar seguem a matriz do RF23. Quando desativados, explicam o motivo no `title`. Cancelar abre uma confirmação.

## Responsividade e acessibilidade

- Páginas fluidas com container de `--container`. Layouts em duas colunas usam flex-wrap: a principal `flex: 999 1 560px`, a lateral `flex: 1 1 380–400px`. No celular, a lateral desce.
- Tabelas largas ficam em caixa com `overflow-x: auto`.
- Use `<button>`, `<a>`, `<label>` reais. Botões só com ícone levam `aria-label`. Avisos de lance usam `role="alert"`.
- O contraste mínimo de 4.5:1 já está garantido pelos tokens.
