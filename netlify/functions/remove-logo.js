// Netlify Function : remove-logo.js
// Reçoit un .docx en base64, retire toutes les images, retourne le .docx nettoyé en base64
// Usage Make : HTTP module POST → { "docx_base64": "...", "session_id": "SOP-xxx" }

const JSZip = require("jszip");

exports.handler = async (event) => {
  // CORS
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "POST requis" }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { docx_base64, session_id } = body;

    if (!docx_base64) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Champ docx_base64 manquant" }),
      };
    }

    // 1. Décoder le base64 → buffer
    const docxBuffer = Buffer.from(docx_base64, "base64");

    // 2. Ouvrir le ZIP (.docx = archive ZIP)
    const zip = await JSZip.loadAsync(docxBuffer);

    // 3. Identifier les images référencées UNIQUEMENT depuis les headers
    //    Le logo MSF est toujours dans l'en-tête — les autres images (schémas, captures)
    //    sont dans le corps du document et ne doivent PAS être supprimées.

    const imageExtensions = /\.(png|jpg|jpeg|gif|bmp|tiff|emf|wmf|svg)$/i;
    const logoImageIds = new Set();   // rId des images dans les headers
    const imagesToRemove = [];        // chemins word/media/ à supprimer

    // 3a. Parcourir les fichiers header*.xml pour collecter les rId d'images
    const headerXmlFiles = [];
    zip.forEach((relativePath) => {
      if (relativePath.match(/word\/header\d*\.xml$/)) {
        headerXmlFiles.push(relativePath);
      }
    });

    for (const headerPath of headerXmlFiles) {
      const headerXml = await zip.file(headerPath).async("string");
      // Extraire les r:embed et r:link qui pointent vers des images
      const rIdMatches = [...headerXml.matchAll(/r:embed="(rId\d+)"/g)];
      rIdMatches.forEach(m => logoImageIds.add({ headerPath, rId: m[1] }));
    }

    // 3b. Pour chaque header, chercher dans son fichier .rels le chemin réel de l'image
    const logoMediaPaths = new Set();

    for (const { headerPath, rId } of logoImageIds) {
      // Ex: word/header1.xml → word/_rels/header1.xml.rels
      const relsPath = headerPath.replace("word/", "word/_rels/") + ".rels";
      if (!zip.file(relsPath)) continue;

      const relsXml = await zip.file(relsPath).async("string");
      // Chercher la relation correspondant au rId
      const relMatch = relsXml.match(
        new RegExp(`Id="${rId}"[^>]*Target="([^"]+)"`)
      );
      if (relMatch) {
        const target = relMatch[1]; // ex: media/image1.png
        const fullPath = target.startsWith("media/")
          ? "word/" + target
          : target;
        if (imageExtensions.test(fullPath)) {
          logoMediaPaths.add(fullPath);
        }
      }
    }

    // 3c. Vérifier que ces images ne sont PAS aussi utilisées dans le corps (document.xml)
    //     Si une image est partagée entre header et corps, on ne la supprime pas du media
    //     mais on retire uniquement sa référence dans le header.
    const bodyOnlyImages = new Set();
    if (zip.file("word/_rels/document.xml.rels")) {
      const bodyRels = await zip.file("word/_rels/document.xml.rels").async("string");
      const bodyMatches = [...bodyRels.matchAll(/Target="(media\/[^"]+)"/g)];
      bodyMatches.forEach(m => bodyOnlyImages.add("word/" + m[1]));
    }

    // Supprimer du media uniquement les images exclusivement dans le header
    for (const mediaPath of logoMediaPaths) {
      if (!bodyOnlyImages.has(mediaPath)) {
        zip.remove(mediaPath);
        imagesToRemove.push(mediaPath);
      }
    }

    // 4. Nettoyer les références XML aux images dans les headers UNIQUEMENT
    for (const headerPath of headerXmlFiles) {
      let xmlContent = await zip.file(headerPath).async("string");

      // Supprimer les blocs <w:drawing>...</w:drawing> (images inline)
      xmlContent = xmlContent.replace(/<w:drawing>[\s\S]*?<\/w:drawing>/g, "");
      // Supprimer les blocs <mc:AlternateContent>...</mc:AlternateContent>
      xmlContent = xmlContent.replace(/<mc:AlternateContent>[\s\S]*?<\/mc:AlternateContent>/g, "");
      // Supprimer les blocs <w:pict>...</w:pict> (format legacy)
      xmlContent = xmlContent.replace(/<w:pict>[\s\S]*?<\/w:pict>/g, "");

      zip.file(headerPath, xmlContent);
    }

    // 5. Nettoyer les relations images dans les .rels des headers UNIQUEMENT
    for (const headerPath of headerXmlFiles) {
      const relsPath = headerPath.replace("word/", "word/_rels/") + ".rels";
      if (!zip.file(relsPath)) continue;

      let relsContent = await zip.file(relsPath).async("string");
      // Supprimer uniquement les relations qui pointaient vers les images supprimées
      for (const mediaPath of logoMediaPaths) {
        const target = mediaPath.replace("word/", "");
        relsContent = relsContent.replace(
          new RegExp(`<Relationship[^>]*Target="${target}"[^>]*/>`, "g"),
          ""
        );
      }
      zip.file(relsPath, relsContent);
    }

    // 6. Extraire le texte brut depuis document.xml
    let texte_extrait = "";
    if (zip.file("word/document.xml")) {
      const documentXml = await zip.file("word/document.xml").async("string");

      // Extraire le texte de chaque paragraphe <w:p>
      const paragraphs = [...documentXml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)];
      const lignes = paragraphs.map(([para]) => {
        // Extraire tous les runs de texte <w:t>
        const runs = [...para.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)];
        return runs.map(([, text]) => text).join("");
      }).filter(ligne => ligne.trim().length > 0);

      texte_extrait = lignes.join("\n");
    }

    // 7. Rezipper → base64
    const cleanedBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const cleanedBase64 = cleanedBuffer.toString("base64");

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        session_id: session_id || "unknown",
        images_supprimees: imagesToRemove.length,
        images_liste: imagesToRemove,
        docx_nettoye_base64: cleanedBase64,
        texte_extrait: texte_extrait,
        nb_caracteres: texte_extrait.length,
        message: `${imagesToRemove.length} image(s) de l'en-tête supprimée(s) — texte extrait (${texte_extrait.length} caractères)`,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Erreur de traitement",
        detail: err.message,
      }),
    };
  }
};
