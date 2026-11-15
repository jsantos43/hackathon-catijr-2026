import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Jornada de lance (Núcleo + Nível 2), com quatro pessoas em navegadores separados:
 * visitante, comitente (Marina) e compradores (Ana, Bruno, Carla). Contas do seed.
 */
const PASSWORD = 'arremate123';
const auctionId = () => process.env.E2E_AUCTION_ID!;

async function loginAs(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/entrar?next=/leiloes/${auctionId()}/sala`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(new RegExp(`/leiloes/${auctionId()}/sala`));
  return page;
}

const price = (page: Page) => page.locator('.room-value');
// Botão principal do painel de lance (o texto muda: "Dar lance · R$ …", "Você é o líder"…).
const bidButton = (page: Page) => page.locator('form button.btn-bid');

async function bidMinimum(page: Page) {
  await page.getByRole('button', { name: 'Mínimo', exact: true }).click();
  await bidButton(page).click();
}

test('visitante vê a listagem, mas precisa entrar para abrir a sala (RF04)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Encontre seu próximo arremate' })).toBeVisible();
  await page.goto(`/leiloes/${auctionId()}/sala`);
  await expect(page).toHaveURL(/\/entrar\?next=/);
});

test('lances em tempo real, aviso de superado, comitente sem lance e presença', async ({ browser }) => {
  const marina = await loginAs(browser, 'marina@arremate.dev');
  const ana = await loginAs(browser, 'ana@arremate.dev');
  const bruno = await loginAs(browser, 'bruno@arremate.dev');

  // Lote com vários itens aparece na sala.
  await expect(ana.getByText(/Lote com 3 itens/)).toBeVisible();

  // Comitente acompanha como espectador e não tem formulário de lance (RF04/RF25).
  await expect(marina.getByText('Este leilão é seu.')).toBeVisible();
  await expect(bidButton(marina)).toHaveCount(0);

  // Ana dá o primeiro lance (pode ser igual ao preço inicial). Todos veem sem recarregar (RF09).
  await bidMinimum(ana);
  await expect(price(ana)).toHaveText(/100,00/);
  await expect(price(bruno)).toHaveText(/100,00/);
  await expect(price(marina)).toHaveText(/100,00/);
  await expect(bidButton(ana)).toHaveText(/Você é o líder/);

  // Bruno cobre com o mínimo (a partir de R$ 100,00 o incremento é R$ 5,00); Ana é avisada na hora (RF26).
  await bidMinimum(bruno);
  await expect(price(ana)).toHaveText(/105,00/);
  await expect(ana.getByText('Seu lance foi superado')).toBeVisible();

  // Lance abaixo do mínimo vigente é recusado com o motivo e o mínimo atual (RF10).
  await ana.locator('#sala-valor').fill('50,00');
  await bidButton(ana).click();
  await expect(ana.getByRole('alert').filter({ hasText: 'Lance recusado' })).toContainText('110,00');
  await expect(price(ana)).toHaveText(/105,00/);

  // Presença: 2 participantes; a comitente conta como espectadora (RF25).
  await expect(ana.locator('[title="Participantes · espectadores"]')).toHaveText(/2\s*·\s*1/);

  // Virar espectador e voltar a participar sem sair da sala.
  await ana.getByRole('button', { name: 'Só assistir' }).click();
  await expect(ana.getByText('Você está assistindo')).toBeVisible();
  await expect(bruno.locator('[title="Participantes · espectadores"]')).toHaveText(/1\s*·\s*2/);
  await ana.getByRole('button', { name: 'Participar da disputa' }).click();
  await expect(bidButton(ana)).toBeVisible();
});

test('quem cai e volta reencontra a sala atualizada (RF24)', async ({ browser }) => {
  const ana = await loginAs(browser, 'ana@arremate.dev');
  const carla = await loginAs(browser, 'carla@arremate.dev');
  const before = (await price(ana).textContent()) ?? '';

  await ana.context().setOffline(true);
  await bidMinimum(carla);
  await expect(price(carla)).not.toHaveText(before);
  const after = (await price(carla).textContent()) ?? '';

  await ana.context().setOffline(false);
  await expect(price(ana)).toHaveText(after, { timeout: 20_000 });
});
