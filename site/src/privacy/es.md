# Política de privacidad - Tab Organizer

Última actualización: 20 de octubre de 2026

## Resumen

Tab Organizer es una extensión de Chrome que ordena y organiza las pestañas del navegador y te permite guardar, restaurar, buscar, importar y exportar conjuntos de ventanas y pestañas como sesiones. Tu privacidad nos importa: todo lo que hace la extensión ocurre dentro de tu navegador, en tu dispositivo.

## Recopilación de datos

Tab Organizer **no** recopila ni transmite ningún dato personal. No hace peticiones de red, no tiene permisos de host, no inyecta scripts en las páginas web y no usa analíticas, rastreo ni telemetría. Todas las operaciones se realizan localmente en tu navegador.

### Qué se guarda y dónde

Cuando guardas una sesión, y mientras las instantáneas automáticas están activadas (ver más abajo), la extensión guarda lo siguiente sobre tus ventanas abiertas en el almacenamiento local de extensiones de Chrome (`chrome.storage.local`), solo en este dispositivo:

- de cada pestaña: su URL, el título de la página, si está fijada y si era la pestaña activa
- de cada grupo de pestañas: su nombre, su color y si estaba contraído
- de cada ventana: su estado (normal, minimizada, maximizada o pantalla completa), su tamaño y posición, y si era la ventana con el foco
- de cada sesión: el nombre que le diste (o el generado por defecto), cuándo se guardó y cuándo cambió por última vez, y una huella breve de la disposición de sus pestañas que sirve para no guardar dos veces instantáneas idénticas
- ajustes de sesiones: si las instantáneas automáticas están activadas, su intervalo, cuántas se conservan y cómo se gestionan las restauraciones grandes

Nunca se capturan las ventanas de incógnito, las ventanas vacías ni las páginas de la propia extensión. Los iconos de los sitios que se muestran en la página de Tab Organizer proceden de la caché de favicons de Chrome y la extensión no los guarda.

Estos datos nunca salen de tu dispositivo: no se sincronizan con tu cuenta de Google, no se suben a ningún servidor y las páginas web no pueden acceder a ellos. La única forma de que los datos de sesiones salgan de la extensión es que tú decidas exportarlos: Exportar crea un archivo o copia texto al portapapeles, solo cuando tú lo pides expresamente.

Tus preferencias de ordenación (el modo de agrupación y cómo se tratan las pestañas duplicadas) se guardan en el almacenamiento sincronizado de Chrome, junto con el número de versión registrado al instalar o actualizar la extensión. Si tienes activada la sincronización de Chrome, esas preferencias, y nada más, pueden sincronizarse entre los dispositivos conectados a la misma cuenta de Chrome. Los datos y ajustes de sesiones nunca se guardan en el almacenamiento sincronizado.

### Instantáneas automáticas

Las instantáneas automáticas están **activadas por defecto**. Cada 5 minutos (u otro intervalo que elijas, de 1 minuto a 24 horas), y cada vez que haces clic en el icono para ordenar, la extensión registra la disposición de tus ventanas abiertas tal como se describe arriba, pero solo si algo ha cambiado desde la última instantánea. Las instantáneas se guardan en el mismo almacenamiento local que las sesiones guardadas y siguen las mismas reglas.

Para desactivarlas, abre Tab Organizer (clic con el botón derecho en el icono → Opciones) y desactiva las instantáneas automáticas en Configuración. Con las instantáneas desactivadas no existe ningún temporizador. La extensión sigue activándose brevemente cuando Chrome se inicia, cuando se instala o actualiza y cuando cambias un ajuste, para mantener en orden sus propios datos guardados; nada de eso usa la red.

## Conservación de datos

- Las sesiones guardadas se conservan hasta que las borras en la página de Tab Organizer.
- Las instantáneas automáticas se conservan en un conjunto rotativo: solo se mantienen las instantáneas no protegidas más recientes (20 por defecto; eliges cuántas en la configuración de la página de Tab Organizer) y las más antiguas se eliminan automáticamente. Una instantánea que marques como protegida se conserva hasta que la borres. La instantánea «Sesión anterior (recuperada)» que se crea tras reiniciar el navegador se protege automáticamente, igual que la anterior; las instantáneas recuperadas más antiguas vuelven al conjunto rotativo y caducan como cualquier otra. Las que protejas tú se conservan mientras quieras. Las instantáneas se pueden borrar una a una o todas a la vez.
- «Eliminar todos los datos de sesiones» en la página de Tab Organizer elimina de inmediato todas las sesiones guardadas e instantáneas; tus ajustes se conservan.
- Al desinstalar la extensión, Chrome elimina todos sus datos guardados.

## Permisos

Esta extensión necesita los siguientes permisos:

- **tabs**: para leer las URL y los títulos de las pestañas al ordenarlas, al guardar sesiones y para la lista de ventanas abiertas de la página de Tab Organizer, y para crear pestañas al restaurar una sesión.
- **tabGroups**: para ordenar y organizar los grupos de pestañas de la ventana actual y para volver a crearlos al restaurar una sesión.
- **storage**: para guardar tus preferencias de ordenación en el almacenamiento sincronizado de Chrome, y para guardar las sesiones, instantáneas y ajustes de sesiones en el almacenamiento local, solo en este dispositivo.
- **contextMenus**: para agregar «¡Reunir!» y «Guardar todas las ventanas como sesión» al menú contextual del icono de la extensión. No se agrega ningún elemento de menú a las páginas web.
- **unlimitedStorage**: permite que las sesiones grandes superen la cuota predeterminada del almacenamiento local de Chrome. No cambia dónde se guardan los datos: todo se queda en tu dispositivo.
- **favicon**: para mostrar, junto a las pestañas de la página de Tab Organizer, los iconos de los sitios desde la caché local de favicons de Chrome. No se descarga ningún icono de la red y la extensión no guarda datos de iconos.
- **alarms**: se usa como temporizador de las instantáneas automáticas, con el intervalo que elijas. Cuando las instantáneas automáticas están desactivadas, no existe ningún temporizador.

La extensión no solicita permisos de host ni usa scripts de contenido. Necesita Chrome 123 o posterior.

## Uso de los datos

- Las URL y los títulos de las pestañas se leen al ordenar y **no** se guardan como parte de la ordenación.
- Cuando guardas una sesión, o mientras las instantáneas automáticas están activadas, los datos indicados arriba se guardan **solo** en el almacenamiento local de extensiones de tu dispositivo y **no** se transmiten a ningún servidor externo.
- Las preferencias de ordenación se guardan con la API de almacenamiento integrada de Chrome y nunca se comparten con terceros ni con servidores externos.
- Nada se vende, se comparte ni se usa para otro fin que no sea ordenar pestañas y guardar, restaurar, buscar, importar y exportar sesiones.

## Servicios de terceros

Tab Organizer **no** usa servicios de terceros de analítica, rastreo ni recopilación de datos.

## Cambios en esta política

Podemos actualizar esta política de privacidad de vez en cuando. Cualquier cambio se publicará en esta página con una nueva fecha de "Última actualización".

## Contacto

Si tienes alguna pregunta sobre esta política de privacidad, abre una incidencia en el [repositorio de GitHub](https://github.com/thilllon/tab-organizer/issues).
