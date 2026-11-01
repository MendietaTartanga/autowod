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

  // Introducimos las credenciales sin registrarlas en los logs.
  await page.type(emailSelector, email);
  await page.type(passwordSelector, password);

  console.log('Enviando las credenciales...');

  await Promise.all([
    page.waitForNavigation({
      waitUntil: 'networkidle2',
      timeout: 60000,
    }).catch(() => null),
    page.click(loginButtonSelector),
  ]);

  // Damos tiempo a que WodBuster muestre posibles avisos.
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const diagnostics = await page.evaluate((selectors) => {
    const visible = (element: Element | null): boolean => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0;
    };

    const messages = Array.from(
      document.querySelectorAll(
        '[role="alert"], .validation-summary-errors, .field-validation-error, .alert, .error'
      )
    )
      .filter(visible)
      .map((element) => element.textContent?.trim() ?? '')
      .filter(Boolean)
      .slice(0, 5);

    const captcha = Boolean(
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

    return {
      url: window.location.href,
      title: document.title,
      loginFormVisible: visible(document.querySelector(selectors.email)),
      captcha,
      messages,
    };
  }, { email: emailSelector });

  if (diagnostics.captcha) {
    throw new Error(
      'WodBuster ha solicitado una verificación CAPTCHA. ' +
      'El proceso se detiene y requiere intervención manual.'
    );
  }

  if (diagnostics.loginFormVisible) {
    console.log('Diagnóstico del inicio de sesión:', JSON.stringify({
      url: diagnostics.url,
      title: diagnostics.title,
      mensajes: diagnostics.messages,
    }));

    const detail = diagnostics.messages.length > 0
      ? diagnostics.messages.join(' | ')
      : 'WodBuster no ha mostrado un mensaje de error reconocible.';

    throw new Error(
      'El formulario de acceso sigue visible. ' + detail
    );
  }

  console.log(
    'El formulario de acceso ya no está visible. ' +
    'Se comprobará el acceso al calendario en el siguiente paso.'
  );
}
