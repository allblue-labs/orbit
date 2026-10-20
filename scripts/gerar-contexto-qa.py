"""Gera `Orbit-Contexto-QA.pdf` a partir de `CONTEXTO-QA.md`.

    python3 scripts/gerar-contexto-qa.py   # a partir da raiz do repositório

Existe para o PDF não virar um binário órfão: quem precisar corrigir o
documento edita o Markdown e roda isto, em vez de abrir um editor de PDF e
perder a fonte.


Não é um conversor de Markdown de uso geral: entende exatamente o subconjunto
usado naquele documento — títulos, parágrafos, listas, tabelas, blocos de
código e citação. Escrever um parser completo para um arquivo que eu mesmo
escrevi seria resolver um problema que não tenho.
"""
import re
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle,
    KeepTogether,
)

TINTA = colors.HexColor("#111827")
SUAVE = colors.HexColor("#4B5563")
ACENTO = colors.HexColor("#1D4ED8")
LINHA = colors.HexColor("#D1D5DB")
FUNDO_CODIGO = colors.HexColor("#F3F4F6")
FUNDO_CABECALHO = colors.HexColor("#EFF6FF")

# As fontes padrão do ReportLab usam WinAnsi e não têm estes glifos: sem a
# troca eles saem como retângulos pretos no PDF.
SEM_GLIFO = {
    "✓": "Sim", "✗": "Não", "→": "->", "≠": "!=", "⟶": "->",
    "≈": "~", "≤": "<=", "≥": ">=",
}


def limpar(texto: str) -> str:
    for ruim, bom in SEM_GLIFO.items():
        texto = texto.replace(ruim, bom)
    # `&` precisa ser escapado antes de qualquer tag entrar.
    texto = texto.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    # Ênfases do Markdown viram marcação do ReportLab.
    texto = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", texto)
    texto = re.sub(r"(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)", r"<i>\1</i>", texto)
    texto = re.sub(r"`(.+?)`", r'<font face="Courier" size="9">\1</font>', texto)
    return texto


estilos = getSampleStyleSheet()
E = {
    "titulo": ParagraphStyle(
        "titulo", parent=estilos["Title"], fontName="Helvetica-Bold",
        fontSize=26, leading=31, textColor=TINTA, spaceAfter=4, alignment=TA_LEFT,
    ),
    "subtitulo": ParagraphStyle(
        "subtitulo", fontName="Helvetica", fontSize=11.5, leading=16,
        textColor=SUAVE, spaceAfter=22,
    ),
    "h1": ParagraphStyle(
        "h1", fontName="Helvetica-Bold", fontSize=16, leading=20,
        textColor=TINTA, spaceBefore=20, spaceAfter=9,
    ),
    "h2": ParagraphStyle(
        "h2", fontName="Helvetica-Bold", fontSize=12.5, leading=16,
        textColor=ACENTO, spaceBefore=14, spaceAfter=6,
    ),
    "h3": ParagraphStyle(
        "h3", fontName="Helvetica-Bold", fontSize=10.5, leading=14,
        textColor=TINTA, spaceBefore=10, spaceAfter=4,
    ),
    "p": ParagraphStyle(
        "p", fontName="Helvetica", fontSize=9.6, leading=14.2,
        textColor=TINTA, spaceAfter=7,
    ),
    "li": ParagraphStyle(
        "li", fontName="Helvetica", fontSize=9.6, leading=14.2,
        textColor=TINTA, leftIndent=12, bulletIndent=3, spaceAfter=3.5,
    ),
    "quote": ParagraphStyle(
        "quote", fontName="Helvetica-Oblique", fontSize=10, leading=15,
        textColor=SUAVE, leftIndent=12, borderPadding=(0, 0, 0, 8),
        spaceBefore=4, spaceAfter=10,
    ),
    "codigo": ParagraphStyle(
        "codigo", fontName="Courier", fontSize=8.4, leading=11.6,
        textColor=TINTA,
    ),
    "celula": ParagraphStyle(
        "celula", fontName="Helvetica", fontSize=8.6, leading=11.8,
        textColor=TINTA,
    ),
    "celulaCab": ParagraphStyle(
        "celulaCab", fontName="Helvetica-Bold", fontSize=8.6, leading=11.8,
        textColor=TINTA,
    ),
}

LARGURA_UTIL = A4[0] - 36 * mm


def tabela(linhas):
    cabecalho, corpo = linhas[0], linhas[1:]
    dados = [[Paragraph(limpar(c), E["celulaCab"]) for c in cabecalho]]
    dados += [[Paragraph(limpar(c), E["celula"]) for c in linha] for linha in corpo]

    colunas = len(cabecalho)
    # A primeira coluna costuma ser o termo; dar-lhe mais espaço evita que o
    # nome quebre em três linhas enquanto a explicação sobra.
    if colunas == 2:
        larguras = [LARGURA_UTIL * 0.34, LARGURA_UTIL * 0.66]
    elif colunas == 3:
        larguras = [LARGURA_UTIL * 0.26, LARGURA_UTIL * 0.37, LARGURA_UTIL * 0.37]
    else:
        larguras = [LARGURA_UTIL / colunas] * colunas

    t = Table(dados, colWidths=larguras, repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), FUNDO_CABECALHO),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, ACENTO),
        ("GRID", (0, 0), (-1, -1), 0.3, LINHA),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def bloco_codigo(linhas):
    texto = "<br/>".join(
        limpar(l).replace(" ", "&nbsp;") if l.strip() else "&nbsp;" for l in linhas
    )
    t = Table([[Paragraph(texto, E["codigo"])]], colWidths=[LARGURA_UTIL], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), FUNDO_CODIGO),
        ("BOX", (0, 0), (-1, -1), 0.3, LINHA),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return t


MARCADOR_LISTA = re.compile(r"^\s*(?:[-*] |\d+\. )")
INICIO_DE_BLOCO = re.compile(r"^\s*$|^#{1,6} |^\|\|?|^```|^> |^---\s*$")


def juntar_continuacoes(linhas):
    """Refaz os parágrafos que o Markdown quebrou em várias linhas.

    O arquivo é escrito com quebra em ~78 colunas. Tratar cada linha física
    como um parágrafo produzia duas falhas de uma vez: o texto saía picado e
    um `**negrito**` aberto numa linha e fechado na seguinte nunca casava com
    a expressão — aparecia literal no PDF.
    """
    saida = []
    for linha in linhas:
        continuacao = (
            saida
            and linha.strip()
            and linha.startswith((" ", "\t"))
            and not MARCADOR_LISTA.match(linha)
            and not INICIO_DE_BLOCO.match(linha.strip())
            and saida[-1].strip()
        )
        corrida = (
            saida
            and linha.strip()
            and not linha.startswith((" ", "\t"))
            and not MARCADOR_LISTA.match(linha)
            and not INICIO_DE_BLOCO.match(linha)
            and not linha.startswith("|")
            and saida[-1].strip()
            and not INICIO_DE_BLOCO.match(saida[-1])
            and not saida[-1].startswith("|")
            and not MARCADOR_LISTA.match(saida[-1])
        )
        if continuacao or corrida:
            saida[-1] = saida[-1].rstrip() + " " + linha.strip()
        else:
            saida.append(linha)
    return saida


def construir(markdown: str):
    historia = []
    linhas = markdown.split("\n")
    i = 0
    primeiro_titulo = True

    while i < len(linhas):
        linha = linhas[i]

        if linha.startswith("```"):
            i += 1
            buffer = []
            while i < len(linhas) and not linhas[i].startswith("```"):
                buffer.append(linhas[i]); i += 1
            historia.append(Spacer(1, 4))
            historia.append(bloco_codigo(buffer))
            historia.append(Spacer(1, 9))
            i += 1
            continue

        if linha.startswith("|"):
            buffer = []
            while i < len(linhas) and linhas[i].startswith("|"):
                buffer.append(linhas[i]); i += 1
            celulas = [
                [c.strip() for c in l.strip().strip("|").split("|")]
                for l in buffer
                # A linha de separação (---|---) não é dado.
                if not re.fullmatch(r"[\s|:-]+", l)
            ]
            if celulas:
                historia.append(Spacer(1, 4))
                historia.append(tabela(celulas))
                historia.append(Spacer(1, 11))
            continue

        if linha.startswith("### "):
            historia.append(Paragraph(limpar(linha[4:]), E["h3"]))
        elif linha.startswith("## "):
            historia.append(Paragraph(limpar(linha[3:]), E["h2"]))
        elif linha.startswith("# "):
            if primeiro_titulo:
                historia.append(Paragraph(limpar(linha[2:]), E["titulo"]))
                primeiro_titulo = False
            else:
                historia.append(Paragraph(limpar(linha[2:]), E["h1"]))
        elif linha.startswith("> "):
            historia.append(Paragraph(limpar(linha[2:]), E["quote"]))
        elif re.match(r"^\s*[-*] ", linha):
            recuo = (len(linha) - len(linha.lstrip())) // 2
            estilo = ParagraphStyle(
                f"li{recuo}", parent=E["li"], leftIndent=12 + recuo * 12,
                bulletIndent=3 + recuo * 12,
            )
            historia.append(
                Paragraph(limpar(linha.lstrip()[2:]), estilo, bulletText="•")
            )
        elif re.match(r"^\s*\d+\. ", linha):
            marcador = re.match(r"^\s*(\d+)\. ", linha)
            historia.append(
                Paragraph(
                    limpar(re.sub(r"^\s*\d+\. ", "", linha)),
                    E["li"],
                    bulletText=f"{marcador.group(1)}.",
                )
            )
        elif linha.strip() == "---":
            historia.append(Spacer(1, 6))
        elif linha.strip():
            historia.append(Paragraph(limpar(linha), E["p"]))

        i += 1

    return historia


def rodape(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(SUAVE)
    canvas.drawString(18 * mm, 12 * mm, "Orbit — Contexto para Engenharia de Qualidade")
    canvas.drawRightString(A4[0] - 18 * mm, 12 * mm, str(doc.page))
    canvas.setStrokeColor(LINHA)
    canvas.setLineWidth(0.3)
    canvas.line(18 * mm, 16 * mm, A4[0] - 18 * mm, 16 * mm)
    canvas.restoreState()


def main():
    texto = open("CONTEXTO-QA.md", encoding="utf-8").read()

    # Fora dos blocos de código, parágrafos e itens de lista voltam a ser uma
    # linha só.
    partes = texto.split("```")
    for indice in range(0, len(partes), 2):
        partes[indice] = "\n".join(
            juntar_continuacoes(partes[indice].split("\n"))
        )
    texto = "```".join(partes)

    # O título e a citação de abertura ganham tratamento próprio.
    texto = texto.replace(
        "> Documento de entrada para quem vai testar o Orbit pela primeira vez, nas três\n> superfícies: API, painel web e aplicativo de campo.",
        "> Documento de entrada para quem vai testar o Orbit pela primeira vez, nas três superfícies: API, painel web e aplicativo de campo.",
    )

    doc = BaseDocTemplate(
        "Orbit-Contexto-QA.pdf",
        pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=22 * mm,
        title="Orbit — Contexto para Engenharia de Qualidade",
        author="Orbit",
        subject="Contexto do produto, pontos de teste e roteiros de ponta a ponta",
    )
    quadro = Frame(
        doc.leftMargin, doc.bottomMargin,
        doc.width, doc.height, id="corpo", showBoundary=0,
    )
    doc.addPageTemplates([PageTemplate(id="padrao", frames=[quadro], onPage=rodape)])
    doc.build(construir(texto))
    print("PDF gerado")


main()
