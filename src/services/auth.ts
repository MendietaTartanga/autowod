import { Page } from 'puppeteer';

export async function login(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  const emailSelector = '#body_body_CtlLogin_IoEmail';
  const passwordSelector = '#body_body_CtlLogin_IoPassword';
  const loginButtonSelector = '#body_body_CtlLogin_CtlAceptar';

  console.log('Esperando el formulario de inicio de sesión...');

  await page.waitForSelector(emailSelector, {
    visible: true,
    timeout: 30000,
  });

  await page.waitForSelector(passwordSelector, {
    visible: true,
    timeout: 10000,
  });

  await page.waitForSelector(loginButtonSelector, {
    visible: true,
    timeout: 10000,
  });

  // Introducimos las credenciales.
  await page.type(emailSelector, email);
  await page.type(passwordSelector, password);

  console.log('Enviando las credenciales...');

  // Esperamos a que termine la navegación o la respuesta de la página.
  await Promise.all([
    page.waitForNavigation({
      waitUntil: 'networkidle2',
      timeout: 60000,
    }).catch(() => null),

    page.click(loginButtonSelector),
  ]);

  // Comprobamos si aparece algún CAPTCHA conocido.
  const captchaDetected = await page.evaluate(() => {
    return Boolean(
      document.querySelector(
        [
          'iframe[src*="recaptcha"]',
          'iframe[src*="hcaptcha"]',
          '.g-recaptcha',
          '.h-captcha',
          '[data-sitekey]',
        ].join(',')
      )
    );
  });

  if (captchaDetected) {
    throw new Error(
      'WodBuster ha solicitado una verificación CAPTCHA. ' +
      'El proceso se detiene y requiere intervención manual.'
    );
  }

  // Comprobamos si el formulario de acceso sigue visible.
  const loginFormStillVisible = await page
    .waitForSelector(emailSelector, {
      visible: true,
      timeout: 5000,
    })
    .then(() => true)
    .catch(() => false);

  if (loginFormStillVisible) {
    throw new Error(
      'No se ha podido iniciar sesión. ' +
      'Comprueba las credenciales o si WodBuster solicita ' +
      'una verificación adicional.'
    );
  }

  console.log(
    'El formulario de acceso ya no está visible. ' +
    'Se comprobará el acceso al calendario en el siguiente paso.'
  );
}
