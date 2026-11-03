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

  try {
    await page.waitForSelector(emailSelector, { visible: true, timeout: 30000 });
  } catch (error) {
    const pageDiagnostic = await page.evaluate(() => ({
      url: window.location.href,
      title: document.title,
      text: (document.body?.innerText ?? '').replace(/\\s+/g, ' ').trim().slice(0, 1200),
      inputs: Array.from(document.querySelectorAll('input')).map(input => ({
        id: input.id,
        name: input.name,
        type: input.type,
        placeholder: input.placeholder,
      })).slice(0, 30),
      buttons: Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"]'))
        .map(button => ({
          id: (button as HTMLButtonElement).id,
          name: (button as HTMLButtonElement).getAttribute('name'),
          text: (button.textContent ?? (button as HTMLInputElement).value ?? '').trim(),
          type: (button as HTMLButtonElement).getAttribute('type'),
        })).slice(0, 20),
    }));
    console.log('Diagnóstico del formulario de acceso:', JSON.stringify(pageDiagnostic));
    throw new Error('No se ha encontrado el campo de email esperado. Revisa el diagnóstico del formulario.');
  }
  await page.waitForSelector(passwordSelector, { visible: true, timeout: 10000 });
  await page.waitForSelector(loginButtonSelector, { visible: true, timeout: 10000 });

  await page.click(emailSelector);
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type(emailSelector, email);

  await page.click(passwordSelector);
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
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
    const style = emailInput ? window.getComputedStyle(emailInput) : null;
    const rect = emailInput ? emailInput.getBoundingClientRect() : null;
    const loginFormVisible = Boolean(
      emailInput && style && style.display !== 'none' &&
      style.visibility !== 'hidden' && rect && rect.width > 0 && rect.height > 0
    );

    const messages = Array.from(document.querySelectorAll(
      '[role="alert"], .validation-summary-errors, .field-validation-error, .alert, .error, [id*="Error"], [id*="error"], [id*="Mensaje"], [id*="mensaje"]'
    ))
      .map((element) => element.textContent?.trim() ?? '')
      .filter((message) => message.length > 0)
      .slice(0, 8);

    const captcha = Boolean(document.querySelector(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha, [data-sitekey]'
    ));

    return {
      url: window.location.href,
      title: document.title,
      loginFormVisible,
      emailFilled: Boolean(emailInput?.value),
      passwordFilled: Boolean(passwordInput?.value),
      emailName: emailInput?.name ?? null,
      passwordName: passwordInput?.name ?? null,
      buttonType: button?.getAttribute('type') ?? null,
      buttonName: button?.getAttribute('name') ?? null,
      formMethod: form?.method ?? null,
      formAction: form?.action ?? null,
      hiddenFieldNames: form
        ? Array.from(form.querySelectorAll('input[type="hidden"]')).map((input) => (input as HTMLInputElement).name).slice(0, 20)
        : [],
      pageText: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 900),
      actions: Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a'))
        .map((element) => ({
          tag: element.tagName,
          id: (element as HTMLElement).id,
          name: element.getAttribute('name'),
          text: (element.textContent ?? (element as HTMLInputElement).value ?? '').trim(),
          href: (element as HTMLAnchorElement).href || null,
          type: element.getAttribute('type'),
          classes: (element as HTMLElement).className?.toString?.() ?? '',
        }))
        .filter((element) => element.text || element.id || element.name)
        .slice(0, 30),
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

  // WodBuster muestra una pantalla intermedia para decidir si recuerda el dispositivo.
  // El botón submit observado en esa pantalla completa el acceso.
  if (diagnostics.pageText.toLowerCase().includes('recordar este dispositivo')) {
    // El control observado en WodBuster es un input submit; el atributo name
    // es más estable que el id generado por ASP.NET.
    const completeLoginSelector = 'input[type="submit"][name="ctl00$ctl00$body$body$CtlLoginComplete"]';
    await page.waitForSelector(completeLoginSelector, { timeout: 20000 });
    const completeButtonInfo = await page.$eval(completeLoginSelector, (element) => {
      const input = element as HTMLInputElement;
      const rect = input.getBoundingClientRect();
      return {
        tag: input.tagName,
        type: input.type,
        value: input.value,
        disabled: input.disabled,
        visible: rect.width > 0 && rect.height > 0 &&
          window.getComputedStyle(input).visibility !== 'hidden',
        formAction: input.form?.action ?? null,
      };
    }).catch(() => null);

    if (!completeButtonInfo) {
      throw new Error('No se encuentra el control de confirmación del dispositivo.');
    }

    console.log('Control de confirmación detectado:', JSON.stringify(completeButtonInfo));
    console.log('Confirmando la pantalla intermedia de acceso...');

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => null),
      page.$eval(completeLoginSelector, (element) => {
        (element as HTMLInputElement).click();
      }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const finalLoginCheck = await page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 700),
  }));

  console.log('Comprobación final del acceso:', JSON.stringify(finalLoginCheck));

  if (new URL(finalLoginCheck.url).pathname.toLowerCase().includes('/account/login.aspx')) {
    throw new Error('WodBuster sigue mostrando el inicio de sesión después de confirmar el dispositivo. No se accederá al calendario.');
  }

  console.log('Resultado del envío del formulario (sin credenciales):', JSON.stringify({
    url: diagnostics.url,
    title: diagnostics.title,
    loginFormVisible: diagnostics.loginFormVisible,
    emailFilled: diagnostics.emailFilled,
    passwordFilled: diagnostics.passwordFilled,
    pageText: diagnostics.pageText,
    actions: diagnostics.actions,
    captcha: diagnostics.captcha,
    mensajes: diagnostics.messages,
  }));

  if (diagnostics.loginFormVisible) {
    console.log('Diagnóstico de acceso (sin credenciales):', JSON.stringify({
      url: diagnostics.url,
      title: diagnostics.title,
      emailFilled: diagnostics.emailFilled,
      passwordFilled: diagnostics.passwordFilled,
      emailName: diagnostics.emailName,
      passwordName: diagnostics.passwordName,
      buttonType: diagnostics.buttonType,
      buttonName: diagnostics.buttonName,
      formMethod: diagnostics.formMethod,
      formAction: diagnostics.formAction,
      hiddenFieldNames: diagnostics.hiddenFieldNames,
      pageText: diagnostics.pageText,
      mensajes: diagnostics.messages,
    }));

    throw new Error('El formulario de acceso sigue visible. Consulta el diagnóstico anterior.');
  }

  console.log('Inicio de sesión aparentemente correcto; se comprobará el calendario.');
}
