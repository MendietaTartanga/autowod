
import { Page } from 'puppeteer';

export async function login(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  const emailSelector = '#body_body_CtlLogin_IoEmail';
  const passwordSelector = '#body_body_CtlLogin_IoPassword';
  const loginButtonSelector = '#body_body_CtlLogin_CtlAceptar';

  await page.waitForSelector(emailSelector, {
    visible: true,
    timeout: 30000,
  });

  await page.type(emailSelector, email);
  await page.type(passwordSelector, password);

  await Promise.all([
    page.waitForNavigation({
      waitUntil: 'networkidle2',
      timeout: 60000,
    }).catch(() => null),
    page.click(loginButtonSelector),
  ]);

  // Si aparece la pantalla de elección del dispositivo,
  // seleccionamos la opción de no recordar el navegador.
  const secondButtonSelector =
    '#body_body_CtlUp label.button:nth-of-type(2)';

  const secondButton = await page
    .waitForSelector(secondButtonSelector, {
      visible: true,
      timeout: 5000,
    })
    .catch(() => null);

  if (secondButton) {
    await secondButton.click();

    await page.waitForNetworkIdle({
      timeout: 10000,
    }).catch(() => {});
  }

  // Comprobamos que ya no estamos en la pantalla de login.
  const loginFormStillVisible = await page
    .waitForSelector(emailSelector, {
      visible: true,
      timeout: 5000,
    })
    .then(() => true)
    .catch(() => false);

  if (loginFormStillVisible) {
    throw new Error(
      'No se ha podido confirmar el inicio de sesión. Comprueba las credenciales o si WodBuster solicita una verificación adicional.'
    );
  }

  console.log('Inicio de sesión aparentemente correcto.');
}
