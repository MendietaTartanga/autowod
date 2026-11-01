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

  await page.waitForSelector(emailSelector, { visible: true, timeout: 30000 });
  await page.waitForSelector(passwordSelector, { visible: true, timeout: 10000 });
  await page.waitForSelector(loginButtonSelector, { visible: true, timeout: 10000 });

  // Limpiamos los campos antes de escribir para evitar valores previos/autocompletados.
  await page.click(emailSelector, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type(emailSelector, email);

  await page.click(passwordSelector, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type(passwordSelector, password);

  console.log('Credenciales introducidas (valores ocultos).');
  console.log('Enviando las credenciales...');

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => null),
    page.click(loginButtonSelector),
  ]);

  await new Promise((resolve) => setTimeout(resolve, 3000));

  const diagnostics = await page.evaluate((selectors) => {
    const emailInput = document.querySelector(selectors.email) as HTMLInputElement | null;
    const passwordInput = document.querySelector(selectors.password) as HTMLInputElement | null;
    const button = document.querySelector(selectors.button) as HTMLButtonElement | HTMLInputElement | null;
    const form = emailInput?.form ?? passwordInput?.form ?? null;

    const visible = (element: Element | null): boolean => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        rect.width > 0 && rect.height > 0;
    };

    const messages = Array.from(document.querySelectorAll(
      '[role="alert"], .validation-summary-errors, .field-validation-error, .alert, .error, [id*="Error"], [id*="error"], [id*="Mensaje"], [id*="mensaje"]'
    ))
      .filter(visible)
      .map((element) => element.textContent?.trim() ?? '')
      .filter((message) => message.length > 0)
      .slice(0, 8);

    const captcha = Boolean(document.querySelector(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha, [data-sitekey]'
    ));

    return {
      url: window.location.href,
      title: document.title,
      loginFormVisible: visible(emailInput),
      emailFilled: Boolean(emailInput?.value),
      passwordFilled: Boolean(passwordInput?.value),
      buttonType: button?.getAttribute('type') ?? null,
      formMethod: form?.method ?? null,
      formAction: form?.action ?? null,
      captcha,
      messages,
    };
  }, {
    email: emailSelector,
    password: passwordSelector,
    button: loginButtonSelector,
  });

  if (diagnostics.captcha) {
    throw new Error('WodBuster ha solicitado una verificación CAPTCHA. El proceso se detiene y requiere intervención manual.');
  }

  if (diagnostics.loginFormVisible) {
    console.log('Diagnóstico de acceso (sin credenciales):', JSON.stringify({
      url: diagnostics.url,
      title: diagnostics.title,
      emailFilled: diagnostics.emailFilled,
      passwordFilled: diagnostics.passwordFilled,
      buttonType: diagnostics.buttonType,
      formMethod: diagnostics.formMethod,
      formAction: diagnostics.formAction,
      mensajes: diagnostics.messages,
    }));

    const detail = diagnostics.messages.length > 0
      ? diagnostics.messages.join(' | ')
      : 'WodBuster no ha mostrado un mensaje de error reconocible.';

    throw new Error('El formulario de acceso sigue visible. ' + detail);
  }

  console.log('Inicio de sesión aparentemente correcto; se comprobará el calendario.');
}
